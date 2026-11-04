import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://localhost:3000";
try {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1050 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("heading", { name: "우리 팀의 회의자료부터 가져와 보세요." })
    .waitFor();
  assert.equal(await page.getByText("직원 로그인", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "새 주간회의", exact: true }).click();
  await page
    .getByRole("dialog", { name: "회의 정보" })
    .getByLabel("회의 제목")
    .fill("브라우저 검증 회의");
  await page.getByRole("button", { name: "회의 정보 닫기" }).click();
  await page
    .getByRole("textbox", { name: "안건 제목", exact: true })
    .fill("패키지 디자인 검토");
  await page.getByLabel("안건 담당자", { exact: true }).fill("담당자 A");
  await page
    .getByRole("textbox", { name: "제품명", exact: true })
    .fill("테스트 제품");
  await page
    .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
    .fill("1차 시안 수령. 로고 위치 검토 필요.");
  await page
    .getByRole("textbox", { name: "다음 계획", exact: true })
    .fill("수정 시안 요청 예정.");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("시안 이미지 선택", { exact: true }).setInputFiles([
    { name: "시안-A.png", mimeType: "image/png", buffer: png },
    { name: "시안-B.png", mimeType: "image/png", buffer: png },
  ]);
  await page
    .getByRole("button", { name: "시안-A 확대", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await page
    .getByRole("button", { name: "시안-A 확대", exact: true })
    .first()
    .click();
  const review = page.getByRole("dialog", { name: "시안 검토" });
  await review.getByLabel("검토 결과").selectOption("changes");
  await review.getByLabel("검토자 이름").fill("검토자");
  await review.getByLabel("컨펌 의견").fill("로고 위치를 중앙으로 조정");
  await review.getByRole("button", { name: "검토 결과 반영" }).click();
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  console.log("PASS: create, image attachment, design feedback and save");
  await page.reload();
  await page
    .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
      .inputValue(),
    "1차 시안 수령. 로고 위치 검토 필요.",
  );
  assert.equal(
    await page
      .getByText("로고 위치를 중앙으로 조정", { exact: true })
      .first()
      .isVisible(),
    true,
  );
  await page.getByRole("button", { name: "디자인 컨펌", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "시안-A 비교 선택", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "시안-B 비교 선택", exact: true })
    .check();
  await page.getByRole("button", { name: /선택한 시안 비교/ }).click();
  await page.getByRole("dialog", { name: "시안 나란히 비교" }).waitFor();
  await page
    .getByRole("dialog", { name: "시안 나란히 비교" })
    .locator("img")
    .nth(1)
    .waitFor();
  assert.equal(
    await page
      .getByRole("dialog", { name: "시안 나란히 비교" })
      .locator("img")
      .count(),
    2,
  );
  await page.getByRole("button", { name: "비교 닫기" }).click();
  await page.getByRole("button", { name: "회의 진행", exact: true }).click();
  await page.getByRole("button", { name: /회의 모드로 보기/ }).click();
  await page.getByRole("dialog", { name: "회의 진행 모드" }).waitFor();
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("button", { name: "컨펌 의견 기록", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "이 안건의 후속 업무 등록", exact: true })
    .click();
  let task = page.getByRole("dialog", { name: "후속 업무 등록" });
  await task.getByLabel("업무 내용").fill("로고 수정 시안 요청");
  await task.getByLabel("담당자", { exact: true }).fill("담당자 A");
  await task.getByRole("button", { name: "업무 등록", exact: true }).click();
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  console.log("PASS: image comparison, presentation and task creation");
  const second = await context.newPage();
  await second.goto(base);
  await second
    .getByRole("textbox", { name: "다음 계획", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
    .fill("담당자 A 수정");
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await second
    .getByRole("textbox", { name: "다음 계획", exact: true })
    .fill("담당자 B의 다음 계획");
  await second.getByRole("button", { name: "회의 저장", exact: true }).click();
  await second
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  assert.equal(
    await second
      .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
      .inputValue(),
    "담당자 A 수정",
  );
  await page
    .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
    .fill("동시 수정 원격 내용");
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await second
    .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
    .fill("동시 수정 로컬 내용");
  await second.getByRole("button", { name: "회의 저장", exact: true }).click();
  await second
    .getByRole("alert")
    .filter({ hasText: "같은 항목이 다른 곳에서도 수정되었습니다" })
    .waitFor();
  assert.equal(
    await second
      .getByRole("textbox", { name: "이번 주 업무 보고", exact: true })
      .inputValue(),
    "동시 수정 로컬 내용",
  );
  await second.close();
  console.log("PASS: cross-tab merge and conflict handling");
  await page
    .getByRole("button", { name: "다음 주 회의 준비", exact: true })
    .click();
  await page.getByRole("button", { name: "후속 업무", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 1);
  assert.equal(await page.getByText("이월", { exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "회의 저장", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 백업", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs("/tmp/azla-conference-backup.zip");
  const restoredContext = await browser.newContext();
  const restored = await restoredContext.newPage();
  restored.on("dialog", (dialog) => dialog.accept());
  await restored.goto(base);
  await restored
    .getByRole("heading", { name: "우리 팀의 회의자료부터 가져와 보세요." })
    .waitFor();
  await restored
    .getByLabel("백업 파일 선택", { exact: true })
    .setInputFiles("/tmp/azla-conference-backup.zip");
  await restored
    .getByRole("status")
    .filter({ hasText: "백업을 불러왔습니다." })
    .waitFor();
  await restored
    .getByRole("button", { name: "회의 저장", exact: true })
    .click();
  await restored
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await restored.reload();
  await restored
    .getByRole("combobox", { name: "회의 선택" })
    .selectOption({ index: 1 });
  await restored
    .getByRole("button", { name: "시안-A 확대", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await restored
      .getByText("로고 위치를 중앙으로 조정", { exact: true })
      .first()
      .isVisible(),
    true,
  );
  await restoredContext.close();
  console.log("PASS: image backup restored in a clean browser context");
  await page.getByRole("button", { name: "회의 진행", exact: true }).click();
  await page.screenshot({
    path: "/tmp/azla-conference-v2.png",
    fullPage: true,
  });
  if (process.env.AZLA_REFERENCE_PPTX) {
    await page
      .getByLabel("PPT 파일 선택", { exact: true })
      .setInputFiles(process.env.AZLA_REFERENCE_PPTX);
    const dialog = page.getByRole("dialog", { name: "PPT 가져오기 미리보기" });
    await dialog.waitFor({ timeout: 30000 });
    assert.equal(
      await dialog.getByLabel("가져올 회의 날짜", { exact: true }).inputValue(),
      "2026-11-02",
    );
    const count = await dialog.locator(".import-slide").count();
    assert.equal(count, 39);
    assert.ok(
      (await dialog
        .getByText("업무 계획 별도 추출됨", { exact: true })
        .count()) > 0,
    );
    await dialog
      .getByRole("button", { name: "39개 페이지 가져오기", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden", timeout: 60000 });
    await page.getByRole("button", { name: "회의 저장", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "회의 내용을 저장했습니다." })
      .waitFor();
    await page
      .getByRole("button", { name: "디자인 컨펌", exact: true })
      .click();
    assert.equal(await page.locator(".design-board .design-card").count(), 23);
    await page.locator(".design-board .design-card img").first().waitFor();
    await page.screenshot({
      path: "/tmp/azla-conference-pptx-design.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "회의 진행", exact: true }).click();
    console.log(
      "PASS: provided PPTX parsed, all 39 slides imported with original text, report/plan columns and images.",
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/azla-conference-mobile-v2.png",
    fullPage: true,
  });
  await page.goto(base + "/login");
  await page.waitForURL(base + "/");
  assert.deepEqual(errors, []);
  const r = await page.request.get(base + "/api/conference");
  assert.equal(r.status(), 503);
  const admin = await page.request.post(base + "/api/admin", { data: {} });
  assert.equal(admin.status(), 410);
  console.log(
    "PASS: login-free create/edit/save/reload, files, design review, compare, presentation, tasks, carry-forward, cross-tab merge/conflict, image backup, mobile and retired login route.",
  );
} finally {
  await browser.close();
}
