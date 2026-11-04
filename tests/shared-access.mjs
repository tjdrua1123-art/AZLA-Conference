// Run against a separate local server with fixture-only credentials and no backend.
// No valid-data endpoint is requested; every check stops before a Supabase network call.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
const origin = "http://localhost:3101";
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    "3101",
  ],
  {
    env: {
      ...process.env,
      SUPABASE_URL: "http://127.0.0.1:9",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-only",
      WORKSPACE_ACCESS_KEY: "fixture-access-key-for-local-testing-only",
      APP_URL: origin,
      OPENAI_API_KEY: "",
    },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(origin + "/api/conference/access");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready)
    throw new Error(
      "Fixture server did not start. Build first and ensure port 3101 is available.",
    );
  const key = "fixture-access-key-for-local-testing-only";
  const request = (path, init = {}) =>
    fetch(origin + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...init.headers,
      },
    });
  const absent = await (await request("/api/conference/access")).json();
  assert.equal(absent.mode, "shared");
  assert.equal(absent.accessible, false);
  assert.equal((await request("/api/conference")).status, 403);
  assert.equal(
    (await request("/api/conference/files?path=azla/file.png")).status,
    403,
  );
  assert.equal(
    (
      await request("/api/conference/access", {
        method: "POST",
        body: JSON.stringify({ key: "wrong" }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/conference/access", {
        method: "POST",
        headers: { Origin: "https://untrusted.invalid" },
        body: JSON.stringify({ key }),
      })
    ).status,
    403,
  );
  const approved = await request("/api/conference/access", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  assert.equal(approved.status, 200);
  const setCookie = approved.headers.getSetCookie()[0];
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=strict/i);
  const cookie = setCookie.split(";")[0];
  const opened = await (
    await request("/api/conference/access", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(opened.accessible, true);
  assert.equal(
    (
      await request("/api/conference", {
        method: "PUT",
        headers: { Cookie: cookie },
        body: JSON.stringify({ version: 0, data: { schema: 100 } }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/conference/files", {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ name: "bad.html", mime: "text/html", size: 10 }),
      })
    ).status,
    400,
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(origin + "/#access=" + key);
    await page.waitForURL(origin + "/");
    await page.getByRole("alert").waitFor();
    assert.equal(new URL(page.url()).hash, "");
    const enabled = await (
      await page.request.get(origin + "/api/conference/access")
    ).json();
    assert.equal(enabled.accessible, true);
    const cookies = await page.context().cookies();
    assert.equal(
      cookies.find((c) => c.name === "azla-workspace")?.httpOnly,
      true,
    );
  } finally {
    await browser.close();
  }
  console.log(
    "PASS: shared-link gate, private endpoint denial, invalid key, origin enforcement, HttpOnly session, fragment removal and input rejection without hosted-service calls.",
  );
} finally {
  server.kill("SIGTERM");
}
