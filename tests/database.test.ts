import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
// Real PostgreSQL engine with minimal Supabase auth/storage schema adapters.
// This validates SQL/RLS/RPC behavior, not hosted Supabase Storage HTTP or Auth email delivery.
test("PostgreSQL: schema, invitation-only access, viewer isolation, history, carry-forward and AI quotas", async () => {
  const db = new PGlite();
  await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to authenticated,anon;
 `);
  await db.exec(
    await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  );
  const editor = "00000000-0000-4000-8000-000000000001",
    viewer = "00000000-0000-4000-8000-000000000002",
    outsider = "00000000-0000-4000-8000-000000000003";
  await db.exec(
    `insert into auth.users values('${editor}'),('${viewer}'),('${outsider}');insert into profiles(id,name,role) values('${editor}','작성자','editor'),('${viewer}','열람자','viewer');`,
  );
  async function as(id: string, role = "authenticated") {
    await db.exec(
      `reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`,
    );
  }
  async function scalar(sql: string, args: unknown[] = []) {
    const r = await db.query<Record<string, unknown>>(sql, args);
    return Object.values(r.rows[0])[0];
  }
  await as(editor);
  const first = await scalar(
    `select create_weekly_meeting('2026-11-02','첫 회의','제품 A','샘플 검토')`,
  );
  const task = await scalar(
    `select add_meeting_task($1,'측정 진행','제품 A',$2,'2026-11-06')`,
    [first, editor],
  );
  assert.equal(
    await scalar(
      `select add_meeting_task($1,' 측정 진행 ','제품 A',$2,'2026-11-06')`,
      [first, editor],
    ),
    task,
    "deduplicates retries",
  );
  const second = await scalar(
    `select create_weekly_meeting('2026-11-09','다음 회의')`,
  );
  assert.equal(await scalar(`select count(*)::int from tasks`), 1);
  assert.equal(
    await scalar(
      `select carried from meeting_tasks where meeting_id=$1 and task_id=$2`,
      [second, task],
    ),
    true,
  );
  await db.query(`update tasks set status='done' where id=$1`, [task]);
  const third = await scalar(
    `select create_weekly_meeting('2026-11-16','세 번째 회의')`,
  );
  assert.equal(
    await scalar(
      `select count(*)::int from meeting_tasks where meeting_id=$1`,
      [third],
    ),
    0,
    "completed tasks do not carry",
  );
  await db.query(
    `update meetings set summary='결정 내용' where id=$1 and version=1`,
    [first],
  );
  assert.equal(
    await scalar(`select version from meetings where id=$1`, [first]),
    2,
  );
  assert.equal(
    await scalar(
      `select count(*)::int from meeting_revisions where meeting_id=$1`,
      [first],
    ),
    2,
  );
  const stale = await db.query(
    `update meetings set summary='stale' where id=$1 and version=1 returning id`,
    [first],
  );
  assert.equal(stale.rows.length, 0);
  await assert.rejects(() =>
    db.query(`update meetings set status='final' where id=$1`, [first]),
  );
  await db.query(
    `update meetings set ai_reviewed=true,status='final' where id=$1`,
    [first],
  );
  await db.query(
    `insert into storage.objects(bucket_id,name) values('meeting-files',$1)`,
    [`${first}/photo.jpg`],
  );
  await assert.rejects(() =>
    db.exec(
      `insert into storage.objects(bucket_id,name) values('meeting-files','bad-path/photo.jpg')`,
    ),
  );
  await as(viewer);
  assert.equal(await scalar("select count(*)::int from meetings"), 3);
  assert.equal(await scalar("select count(*)::int from storage.objects"), 1);
  await assert.rejects(() =>
    db.query(`select create_weekly_meeting('2026-11-23','불법 쓰기')`),
  );
  const denied = await db.query(
    `update meetings set summary='viewer tampering' where id=$1 returning id`,
    [first],
  );
  assert.equal(denied.rows.length, 0);
  await assert.rejects(() =>
    db.exec(`update profiles set role='admin' where id='${viewer}'`),
  );
  await assert.rejects(() =>
    db.query(
      `insert into storage.objects(bucket_id,name) values('meeting-files',$1)`,
      [`${first}/bad.jpg`],
    ),
  );
  await as(outsider);
  assert.equal(await scalar("select count(*)::int from meetings"), 0);
  assert.equal(await scalar("select count(*)::int from storage.objects"), 0);
  await as("", "anon");
  await assert.rejects(() => db.exec("select * from meetings"));
  await assert.rejects(() =>
    db.exec(`select create_weekly_meeting('2026-11-23','anon')`),
  );
  await as(editor);
  for (let i = 0; i < 20; i++)
    await db.query(`select reserve_ai($1,'summary')`, [first]);
  await assert.rejects(() =>
    db.query(`select reserve_ai($1,'summary')`, [first]),
  );
  const reservation = await scalar("select id from ai_usage limit 1");
  await assert.rejects(() =>
    db.query(`select finish_ai($1,'success',10,5)`, [reservation]),
  );
  await as("", "service_role");
  await db.query(`select finish_ai($1,'success',10,5)`, [reservation]);
  await as(editor);
  assert.equal(
    await scalar(`select status from ai_usage where id=$1`, [reservation]),
    "success",
  );
  await assert.rejects(() =>
    db.query(`select manage_employee($1,'admin',true)`, [viewer]),
  );
  await db.exec(
    `reset role;update profiles set role='admin' where id='${editor}';`,
  );
  await as(editor);
  await assert.rejects(() =>
    db.query(`select manage_employee($1,'viewer',false)`, [editor]),
  );
  await db.query(`select manage_employee($1,'editor',true)`, [viewer]);
  assert.equal(
    await scalar(`select role from profiles where id=$1`, [viewer]),
    "editor",
  );
  await assert.rejects(() => db.exec("delete from ai_usage"));
  await assert.rejects(() =>
    db.exec("update meeting_revisions set version=100"),
  );
  await db.exec(
    `reset role;update profiles set active=false where id='${editor}';`,
  );
  await as(editor);
  assert.equal(await scalar("select count(*)::int from meetings"), 0);
  await db.close();
});
