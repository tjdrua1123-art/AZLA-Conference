-- Additive migration. Existing v0.1 tables and private files are left intact.
-- Login-free access is granted by a server-side shared-link cookie, never by public RLS.
begin;
create table public.conference_workspace (
 id text primary key check(id='azla'), version integer not null default 0,
 data jsonb not null default '{"schema":2,"meetings":[],"tasks":[]}'::jsonb,
 updated_at timestamptz not null default now()
);
insert into public.conference_workspace(id) values('azla');
create table public.conference_history (version integer primary key,data jsonb not null,created_at timestamptz not null default now());
create table public.conference_ai_usage (id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('summary','transcribe')),day date not null default (now() at time zone 'Asia/Seoul')::date,status text not null default 'reserved' check(status in ('reserved','success','failed')),input_tokens integer,output_tokens integer,created_at timestamptz not null default now());
alter table public.conference_workspace enable row level security;
alter table public.conference_history enable row level security;
alter table public.conference_ai_usage enable row level security;
revoke all on public.conference_workspace,public.conference_history,public.conference_ai_usage from anon,authenticated;
grant all on public.conference_workspace,public.conference_history,public.conference_ai_usage to service_role;
create function public.save_conference(p_version integer,p_data jsonb) returns integer language plpgsql set search_path=public as $$
declare current_version integer;
begin
 select version into current_version from conference_workspace where id='azla' for update;
 if current_version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
 if jsonb_typeof(p_data)<>'object' or p_data->>'schema'<>'2' or jsonb_typeof(p_data->'meetings')<>'array' or jsonb_typeof(p_data->'tasks')<>'array' then raise exception 'Invalid data'; end if;
 update conference_workspace set version=version+1,data=p_data,updated_at=now() where id='azla';
 insert into conference_history(version,data) values(current_version+1,p_data);
 return current_version+1;
end $$;
create function public.reserve_conference_ai(p_kind text) returns uuid language plpgsql set search_path=public as $$
declare rid uuid; n integer;
begin
 perform pg_advisory_xact_lock(hashtext('azla-conference-ai'));
 select count(*) into n from conference_ai_usage where day=(now() at time zone 'Asia/Seoul')::date;
 if n>=40 then raise exception 'AI_LIMIT'; end if;
 insert into conference_ai_usage(kind) values(p_kind) returning id into rid;return rid;
end $$;
revoke execute on function public.save_conference(integer,jsonb),public.reserve_conference_ai(text) from public,anon,authenticated;
grant execute on function public.save_conference(integer,jsonb),public.reserve_conference_ai(text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('conference-files','conference-files',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf','audio/webm','video/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg']);
-- No anon/authenticated Storage policy. The backend issues scoped signed URLs only after verifying the shared link.
commit;
