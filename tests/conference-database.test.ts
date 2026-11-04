import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("shared workspace: only backend service can read/write; history and version conflict are atomic", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/conference-v2.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("set role anon");
  await assert.rejects(() => db.exec("select * from conference_workspace"));
  await assert.rejects(() => db.exec(`select save_conference(0,'{}')`));
  await db.exec("reset role;set role authenticated");
  await assert.rejects(() => db.exec("select * from conference_workspace"));
  await db.exec("reset role;set role service_role");
  const value = { schema: 2, meetings: [], tasks: [] };
  const result = await db.query<{ save_conference: number }>(
    "select save_conference($1,$2)",
    [0, value],
  );
  assert.equal(result.rows[0].save_conference, 1);
  await assert.rejects(
    () => db.query("select save_conference($1,$2)", [0, value]),
    /VERSION_CONFLICT/,
  );
  const count = await db.query<{ n: number }>(
    "select count(*)::int n from conference_history",
  );
  assert.equal(count.rows[0].n, 1);
  for (let i = 0; i < 40; i++)
    await db.query("select reserve_conference_ai($1)", ["summary"]);
  await assert.rejects(
    () => db.query("select reserve_conference_ai($1)", ["summary"]),
    /AI_LIMIT/,
  );
  await db.exec("reset role");
  const bucket = await db.query<{ public: boolean }>(
    `select public from storage.buckets where id='conference-files'`,
  );
  assert.equal(bucket.rows[0].public, false);
  await db.close();
});
