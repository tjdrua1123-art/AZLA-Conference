import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1060 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000");
  await page.getByRole("heading", { name: "팀의 이번 주를 한눈에." }).waitFor();
  assert.equal(await page.locator(".meeting-row").count(), 4);
  await page.screenshot({ path: "/tmp/azla-dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "11월 1주차 주간회의" }).click();
  await page.getByRole("dialog", { name: "회의록 상세" }).waitFor();
  await page
    .getByRole("button", { name: "녹음 · AI 작성", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "브라우저 녹음", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "회의록 닫기" }).click();
  await page.getByRole("button", { name: "주간회의록", exact: true }).click();
  await page
    .getByRole("textbox", { name: "회의록 키워드 검색" })
    .fill("ASE-500");
  assert.equal(await page.locator(".meeting-row").count(), 1);
  await page.getByRole("button", { name: "업무 진행 현황" }).click();
  await page.getByLabel("업무 상태 필터").selectOption("done");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("button", { name: "제품 개발 이력" }).click();
  assert.equal(await page.locator(".product-card").count(), 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "대시보드", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "/tmp/azla-mobile.png", fullPage: true });
  const ai = await page.request.post("http://localhost:3000/api/ai", {
    data: {},
  });
  assert.ok(ai.status() >= 400);
  const admin = await page.request.post("http://localhost:3000/api/admin", {
    data: {},
  });
  assert.ok(admin.status() >= 400);
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("이메일", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "로그인", exact: true })
      .isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: dashboard, meeting details, AI read-only preview, search, task filtering, product history, mobile, protected APIs, unconfigured login.",
  );
} finally {
  await browser.close();
}
