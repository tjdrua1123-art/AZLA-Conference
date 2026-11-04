-- Run once on a NEW Supabase project. Back up before changing an existing database.
begin;
create table public.profiles (
 id uuid primary key references auth.users(id), name text not null check(length(name) between 1 and 100),
 role text not null default 'viewer' check(role in ('admin','editor','viewer')), active boolean not null default true
);
create function public.staff_role() returns text language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() and active $$;
create function public.can_write() returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.staff_role() in ('admin','editor'),false) $$;
create table public.meetings (
 id uuid primary key default gen_random_uuid(), meeting_date date not null, title text not null check(length(trim(title)) between 1 and 200),
 agenda text not null default '', product text not null default '', notes text not null default '', transcript text not null default '',
 summary text not null default '', discussion text not null default '', decisions text not null default '',
 status text not null default 'draft' check(status in ('draft','final')), ai_reviewed boolean not null default false,
 version integer not null default 1, created_by uuid not null default auth.uid() references profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (status <> 'final' or ai_reviewed)
);
create index meetings_date_idx on public.meetings(meeting_date desc);
create index meetings_product_idx on public.meetings(product);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 500), product text not null default '',
 owner_id uuid references profiles(id), due_date date, status text not null default 'todo' check(status in ('todo','doing','done')),
 created_by uuid not null default auth.uid() references profiles(id), created_at timestamptz not null default now()
);
create table public.meeting_tasks (
 meeting_id uuid not null references meetings(id), task_id uuid not null references tasks(id), carried boolean not null default false,
 primary key(meeting_id,task_id)
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), meeting_id uuid not null references meetings(id), path text not null unique,
 name text not null check(length(name) between 1 and 240), mime_type text not null, size bigint not null check(size > 0 and size <= 20971520),
 created_by uuid not null default auth.uid() references profiles(id), created_at timestamptz not null default now(),
 check(split_part(path,'/',1)=meeting_id::text)
);
create table public.meeting_revisions (
 id bigint generated always as identity primary key, meeting_id uuid not null references meetings(id), version integer not null,
 snapshot jsonb not null, changed_by uuid references profiles(id), created_at timestamptz not null default now(), unique(meeting_id,version)
);
create table public.task_revisions (
 id bigint generated always as identity primary key, task_id uuid not null references tasks(id), snapshot jsonb not null,
 changed_by uuid references profiles(id), created_at timestamptz not null default now()
);
create table public.ai_usage (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id), meeting_id uuid not null references meetings(id),
 kind text not null check(kind in ('summary','transcribe')), usage_date date not null default ((now() at time zone 'Asia/Seoul')::date),
 status text not null default 'reserved' check(status in ('reserved','success','failed')), input_tokens integer, output_tokens integer,
 created_at timestamptz not null default now()
);
-- AFTER trigger stores the final version; BEFORE update sets it.
create function public.bump_meeting() returns trigger language plpgsql set search_path=public as $$
begin
 if new.id<>old.id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Immutable fields'; end if;
 if new.version<>old.version then raise exception 'Version is managed by database'; end if;
 new.version=old.version+1; new.updated_at=now(); return new;
end $$;
create function public.record_meeting() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into meeting_revisions(meeting_id,version,snapshot,changed_by) values(new.id,new.version,to_jsonb(new),auth.uid()); return new; end $$;
create trigger meeting_bump before update on meetings for each row execute function bump_meeting();
create trigger meeting_history after insert or update on meetings for each row execute function record_meeting();
create function public.record_task() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into task_revisions(task_id,snapshot,changed_by) values(new.id,to_jsonb(new),auth.uid()); return new; end $$;
create trigger task_history after insert or update on tasks for each row execute function record_task();
create function public.create_weekly_meeting(p_date date,p_title text,p_product text default '',p_agenda text default '') returns uuid
language plpgsql security definer set search_path=public as $$
declare mid uuid;
begin
 if not can_write() then raise exception 'Forbidden'; end if;
 insert into meetings(meeting_date,title,product,agenda) values(p_date,p_title,p_product,p_agenda) returning id into mid;
 -- Link existing unfinished tasks; never clone them. Only earlier meetings participate.
 insert into meeting_tasks(meeting_id,task_id,carried)
 select distinct mid,t.id,true from tasks t join meeting_tasks mt on mt.task_id=t.id join meetings m on m.id=mt.meeting_id
 where t.status<>'done' and m.meeting_date<p_date on conflict do nothing;
 return mid;
end $$;
create function public.add_meeting_task(p_meeting uuid,p_title text,p_product text default '',p_owner uuid default null,p_due date default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare tid uuid;
begin
 if not can_write() then raise exception 'Forbidden'; end if;
 perform 1 from meetings where id=p_meeting for update;
 if not found then raise exception 'Meeting not found'; end if;
 if p_owner is not null and not exists(select 1 from profiles where id=p_owner and active) then raise exception 'Invalid owner'; end if;
 select t.id into tid from tasks t join meeting_tasks mt on mt.task_id=t.id where mt.meeting_id=p_meeting
 and lower(trim(t.title))=lower(trim(p_title)) and t.product=p_product and t.owner_id is not distinct from p_owner limit 1;
 if tid is null then
 insert into tasks(title,product,owner_id,due_date) values(trim(p_title),p_product,p_owner,p_due) returning id into tid;
 insert into meeting_tasks(meeting_id,task_id) values(p_meeting,tid);
 end if;
 return tid;
end $$;
-- Called as the authenticated user, not with service-role credentials. Atomic daily caps including failed calls.
create function public.reserve_ai(p_meeting uuid,p_kind text) returns uuid language plpgsql security definer set search_path=public as $$
declare rid uuid; n integer; total integer;
begin
 if not can_write() or p_kind not in ('summary','transcribe') then raise exception 'Forbidden'; end if;
 if not exists(select 1 from meetings where id=p_meeting) then raise exception 'Meeting not found'; end if;
 perform pg_advisory_xact_lock(hashtext('azla-ai-global'));
 select count(*) into n from ai_usage where user_id=auth.uid() and kind=p_kind and usage_date=(now() at time zone 'Asia/Seoul')::date;
 select count(*) into total from ai_usage where usage_date=(now() at time zone 'Asia/Seoul')::date;
 if n >= (case when p_kind='summary' then 20 else 10 end) or total>=100 then raise exception 'AI daily limit reached'; end if;
 insert into ai_usage(user_id,meeting_id,kind) values(auth.uid(),p_meeting,p_kind) returning id into rid; return rid;
end $$;
-- Only backend service role can record outcomes, clients cannot reset quotas.
create function public.finish_ai(p_id uuid,p_status text,p_input integer default null,p_output integer default null) returns void language sql set search_path=public as $$
 update ai_usage set status=p_status,input_tokens=p_input,output_tokens=p_output where id=p_id;
$$;
revoke execute on function public.finish_ai(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.finish_ai(uuid,text,integer,integer) to service_role;
alter table profiles enable row level security;
alter table meetings enable row level security;
alter table tasks enable row level security;
alter table meeting_tasks enable row level security;
alter table attachments enable row level security;
alter table meeting_revisions enable row level security;
alter table task_revisions enable row level security;
alter table ai_usage enable row level security;
create policy staff_read on profiles for select to authenticated using(staff_role() is not null);
-- Employee administration is server-only; clients cannot promote themselves or others.
create policy staff_read on meetings for select to authenticated using(staff_role() is not null);
create policy staff_insert on meetings for insert to authenticated with check(can_write() and created_by=auth.uid());
create policy staff_update on meetings for update to authenticated using(can_write()) with check(can_write());
create policy staff_read on tasks for select to authenticated using(staff_role() is not null);
create policy staff_update on tasks for update to authenticated using(can_write()) with check(can_write());
create policy staff_read on meeting_tasks for select to authenticated using(staff_role() is not null);
create policy staff_read on attachments for select to authenticated using(staff_role() is not null);
create policy staff_insert on attachments for insert to authenticated with check(can_write() and created_by=auth.uid());
create policy staff_read on meeting_revisions for select to authenticated using(staff_role() is not null);
create policy staff_read on task_revisions for select to authenticated using(staff_role() is not null);
create policy usage_read on ai_usage for select to authenticated using(user_id=auth.uid() or staff_role()='admin');
-- Private bucket, 20 MiB. UUID paths prevent accidental overwrite. No deletion policy: retention by default.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('meeting-files','meeting-files',false,20971520,
 array['image/jpeg','image/png','image/webp','application/pdf','audio/webm','video/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg']);
create policy azla_file_read on storage.objects for select to authenticated using(bucket_id='meeting-files' and public.staff_role() is not null);
create policy azla_file_insert on storage.objects for insert to authenticated with check(bucket_id='meeting-files' and public.can_write() and exists(select 1 from public.meetings where id::text=(storage.foldername(name))[1]));
create function public.manage_employee(p_id uuid,p_role text,p_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtext('azla-staff-management'));
 if staff_role()<>'admin' or staff_role() is null then raise exception 'Forbidden'; end if;
 if p_id=auth.uid() then raise exception 'Cannot change own access'; end if;
 if p_role not in ('admin','editor','viewer') or p_active is null then raise exception 'Invalid role'; end if;
 update profiles set role=p_role,active=p_active where id=p_id;
 if not found then raise exception 'Employee not found'; end if;
end $$;
revoke execute on function manage_employee(uuid,text,boolean) from public,anon;
grant execute on function manage_employee(uuid,text,boolean) to authenticated;
-- Explicit grants make this migration independent of Supabase default privileges.
revoke all on profiles,meetings,tasks,meeting_tasks,attachments,meeting_revisions,task_revisions,ai_usage from anon,authenticated;
grant select on profiles,meetings,tasks,meeting_tasks,attachments,meeting_revisions,task_revisions,ai_usage to authenticated;
grant insert on meetings,attachments to authenticated;
grant select,insert,update on profiles to service_role;
grant select,update on ai_usage to service_role;
grant update(meeting_date,title,product,agenda,notes,transcript,summary,discussion,decisions,status,ai_reviewed) on meetings to authenticated;
grant update(title,product,owner_id,due_date,status) on tasks to authenticated;
-- No anon callable business RPCs. RLS still protects every direct table request.
revoke execute on function staff_role(),can_write(),bump_meeting(),record_meeting(),record_task(),create_weekly_meeting(date,text,text,text),add_meeting_task(uuid,text,text,uuid,date),reserve_ai(uuid,text),finish_ai(uuid,text,integer,integer) from public,anon;
grant execute on function staff_role(),can_write(),create_weekly_meeting(date,text,text,text),add_meeting_task(uuid,text,text,uuid,date),reserve_ai(uuid,text) to authenticated;
grant execute on function finish_ai(uuid,text,integer,integer) to service_role;
commit;
