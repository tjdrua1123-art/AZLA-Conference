import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const base = process.env.TEST_BASE_URL || "http://localhost:3100";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const source = "시안 B의 로고 위치를 수정합니다. 샘플 일정은 다시 확인합니다.";
const draft = {
  summary: [
    { text: "디자인 수정과 샘플 일정을 논의했습니다.", evidence: source },
  ],
  discussion: [
    {
      text: "시안 B 로고 위치 수정",
      evidence: "시안 B의 로고 위치를 수정합니다.",
    },
  ],
  decisions: [
    {
      text: "로고 위치를 수정합니다.",
      evidence: "시안 B의 로고 위치를 수정합니다.",
    },
  ],
  tasks: [
    {
      title: "샘플 일정 확인",
      owner: null,
      due_date: null,
      evidence: "샘플 일정은 다시 확인합니다.",
    },
  ],
};
try {
  const context = await browser.newContext({
    viewport: { width: 1550, height: 1050 },
    permissions: ["microphone"],
    acceptDownloads: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.clock.install();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failNext = false;
  const aiCalls = [];
  await context.route("**/api/conference/access", (route) =>
    route.fulfill({ json: { mode: "local", accessible: true, ai: true } }),
  );
  await context.route("**/api/ai", (route) => {
    const b = route.request().postDataJSON();
    aiCalls.push(b.kind);
    if (failNext) {
      failNext = false;
      return route.fulfill({
        status: 503,
        json: { error: "검증용 일시적 연결 실패" },
      });
    }
    return route.fulfill({
      json: b.kind === "transcribe" ? { text: source } : { draft },
    });
  });
  await page.goto(base);
  await page
    .getByRole("heading", { name: "첫 주간회의를 시작하세요." })
    .waitFor();
  assert.deepEqual(
    await page
      .getByRole("tab")
      .allTextContents()
      .then((x) => x.map((s) => s.replace(/\d+/g, "").trim())),
    [
      "신제품개발",
      "디자인",
      "생산관련업데이트",
      "보류",
      "중단",
      "회의 녹음 내용",
    ],
  );
  assert.equal(await page.getByText("작성자", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "새 주간회의", exact: true }).click();
  const metadata = page.getByRole("dialog", { name: "회의 정보" });
  await metadata.getByLabel("회의 제목").fill("주간회의 검증");
  await metadata.getByRole("button", { name: "저장하고 닫기" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  async function add(category, title, images = false) {
    await page.getByRole("tab", { name: category, exact: true }).click();
    await page
      .getByRole("button", {
        name: category === "디자인" ? "디자인 등록" : "안건 등록",
        exact: true,
      })
      .click();
    const entry = page.getByRole("dialog", { name: "안건 등록" });
    await entry.getByLabel("안건 제목", { exact: true }).fill(title);
    await entry
      .getByLabel("진행 내용", { exact: true })
      .fill(title + " 진행 중");
    await entry
      .getByLabel("회의 결정", { exact: true })
      .fill(title + " 회의 결정");
    if (images)
      await entry.getByLabel("첨부파일 선택", { exact: true }).setInputFiles([
        { name: "시안-A.png", mimeType: "image/png", buffer: png },
        { name: "시안-B.png", mimeType: "image/png", buffer: png },
      ]);
    if (images) {
      await entry
        .getByRole("button", { name: "시안-A.png 첨부 취소", exact: true })
        .waitFor();
      await entry
        .getByRole("button", { name: "시안-B.png 첨부 취소", exact: true })
        .waitFor();
    }
    await entry
      .getByRole("button", { name: "저장 후 닫기", exact: true })
      .click();
    await entry.waitFor({ state: "hidden" });
  }
  await add("신제품개발", "개발 전용");
  await add("디자인", "디자인 전용", true);
  await add("생산관련업데이트", "생산 전용");
  await add("보류", "보류 전용");
  await add("중단", "중단 전용");
  const allTitles = [
    "개발 전용",
    "디자인 전용",
    "생산 전용",
    "보류 전용",
    "중단 전용",
  ];
  for (const [i, category] of [
    "신제품개발",
    "디자인",
    "생산관련업데이트",
    "보류",
    "중단",
  ].entries()) {
    await page.getByRole("tab", { name: category, exact: true }).click();
    assert.ok(
      (await page.getByText(allTitles[i], { exact: true }).count()) > 0,
    );
    for (const other of allTitles.filter((t) => t !== allTitles[i]))
      assert.equal(await page.getByText(other, { exact: true }).count(), 0);
  }
  console.log(
    "PASS: exact six tabs, content entry, author removal and strict category isolation.",
  );
  await page.getByRole("tab", { name: "디자인", exact: true }).click();
  await page.getByRole("button", { name: "시안-A 확대", exact: true }).click();
  let review = page.getByRole("dialog", { name: "시안 검토" });
  await review.getByLabel("검토 결과").selectOption("changes");
  await review.getByLabel("검토자 이름").fill("검토자");
  await review.getByLabel("컨펌 의견").fill("로고 위치 수정");
  await review.getByRole("button", { name: "검토 결과 반영" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await page
    .getByRole("checkbox", { name: "시안-A 비교 선택", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "시안-B 비교 선택", exact: true })
    .check();
  await page.getByRole("button", { name: /시안 비교/ }).click();
  await page
    .getByRole("dialog", { name: "시안 나란히 비교" })
    .locator("img")
    .nth(1)
    .waitFor();
  await page.getByRole("button", { name: "비교 닫기" }).click();
  await page.getByRole("tab", { name: "신제품개발", exact: true }).click();
  await page.getByRole("button", { name: "회의 시작", exact: true }).click();
  const start = page.getByRole("dialog", { name: "회의 녹음 시작" });
  await start.getByRole("checkbox").check();
  await start.getByRole("button", { name: "동의하고 녹음 시작" }).click();
  await page.getByRole("button", { name: "회의 종료", exact: true }).waitFor();
  for (const category of [
    "디자인",
    "생산관련업데이트",
    "보류",
    "중단",
    "회의 녹음 내용",
    "신제품개발",
  ]) {
    await page.getByRole("tab", { name: category, exact: true }).click();
    await page.waitForTimeout(400);
    assert.equal(
      await page
        .getByRole("button", { name: "회의 종료", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(await page.locator(".live-status").count(), 1);
  }
  assert.equal(aiCalls.length, 0);
  // Exercise the four-minute segment boundary without making the test run for four minutes.
  await page.clock.fastForward(240100);
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("azla-conference-v2", 1);
        r.onsuccess = () => {
          const db = r.result;
          const q = db.transaction("state").objectStore("state").get("board");
          q.onsuccess = () => {
            resolve(
              (q.result?.data.meetings[0].recordings[0].parts.length ?? 0) >= 1,
            );
            db.close();
          };
        };
      }),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "회의 종료", exact: true })
      .isVisible(),
    true,
  );
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "회의 종료", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 녹음과 취합 요약을 자동으로 저장했습니다." })
    .waitFor();
  assert.equal(
    await page
      .getByRole("tab", { name: "회의 녹음 내용", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(aiCalls, ["transcribe", "transcribe", "summary"]);
  await page.getByLabel("회의 녹음 재생", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "핵심 요약 1", exact: true })
      .inputValue(),
    draft.summary[0].text,
  );
  async function stored() {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open("azla-conference-v2", 1);
          r.onsuccess = () => {
            const db = r.result;
            const q = db.transaction("state").objectStore("state").get("board");
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
            q.onerror = () => reject(q.error);
          };
        }),
    );
  }
  let state = await stored();
  let recorded = state.data.meetings[0].recordings[0];
  assert.equal(recorded.status, "ready");
  assert.ok(recorded.parts[0].size > 0);
  assert.equal(recorded.parts.length, 2);
  assert.deepEqual(
    recorded.parts.map((p) => p.sequence),
    [1, 2],
  );
  assert.equal(recorded.transcript, source + "\n\n" + source);
  assert.equal(recorded.draft.summary[0].text, draft.summary[0].text);
  assert.equal(state.data.meetings[0].agenda[0].report, "개발 전용 진행 중");
  await page.reload();
  await page.getByRole("tab", { name: "회의 녹음 내용", exact: true }).click();
  await page
    .getByRole("textbox", { name: "핵심 요약 1", exact: true })
    .waitFor();
  console.log(
    "PASS: real MediaRecorder capture survives every application tab; ending automatically transcribes, summarizes and persists separately. AI responses are controlled test fixtures.",
  );
  await page.getByRole("button", { name: "회의 시작", exact: true }).click();
  await page
    .getByRole("dialog", { name: "회의 녹음 시작" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "동의하고 녹음 시작" }).click();
  await page.getByRole("button", { name: "회의 종료", exact: true }).waitFor();
  await page.waitForTimeout(800);
  failNext = true;
  await page.getByRole("button", { name: "회의 종료", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "검증용 일시적 연결 실패" })
    .waitFor();
  state = await stored();
  assert.equal(state.data.meetings[0].recordings[1].status, "failed");
  assert.ok(state.data.meetings[0].recordings[1].parts.length > 0);
  await page.getByRole("button", { name: "다시 정리", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 녹음과 취합 요약을 자동으로 저장했습니다." })
    .waitFor();
  await page.getByRole("button", { name: "회의 도구", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 백업", exact: true }).click();
  await (await dl).saveAs("/tmp/azla-v03-backup.zip");
  const clean = await browser.newContext();
  const cleanPage = await clean.newPage();
  cleanPage.on("dialog", (d) => d.accept());
  await cleanPage.goto(base);
  await cleanPage
    .getByRole("heading", { name: "첫 주간회의를 시작하세요." })
    .waitFor();
  await cleanPage
    .getByLabel("백업 파일 선택", { exact: true })
    .setInputFiles("/tmp/azla-v03-backup.zip");
  await cleanPage
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  await cleanPage
    .getByRole("tab", { name: "회의 녹음 내용", exact: true })
    .click();
  await cleanPage
    .getByRole("textbox", { name: "핵심 요약 1", exact: true })
    .waitFor();
  await cleanPage.getByLabel("회의 녹음 재생", { exact: true }).waitFor();
  await clean.close();
  console.log(
    "PASS: provider failure preserves audio, retry recovers summary; ZIP restoration includes original audio and saved summaries.",
  );
  await page.getByRole("tab", { name: "신제품개발", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "내용 작성", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "취합 회의자료", exact: true })
      .count(),
    0,
  );
  const second = await context.newPage();
  await second.goto(base);
  await page
    .getByRole("button", { name: "개발 전용 수정", exact: true })
    .click();
  await second
    .getByRole("button", { name: "개발 전용 수정", exact: true })
    .click();
  const firstEditor = page.getByRole("dialog", {
    name: "안건 수정",
    exact: true,
  });
  const secondEditor = second.getByRole("dialog", {
    name: "안건 수정",
    exact: true,
  });
  await firstEditor
    .getByLabel("진행 내용", { exact: true })
    .fill("동시 수정 진행");
  await firstEditor
    .getByRole("button", { name: "저장 후 닫기", exact: true })
    .click();
  await firstEditor.waitFor({ state: "hidden" });
  await secondEditor
    .getByLabel("회의 결정", { exact: true })
    .fill("다른 탭 회의 결정");
  await secondEditor
    .getByRole("button", { name: "저장 후 닫기", exact: true })
    .click();
  await secondEditor.waitFor({ state: "hidden" });
  await second.getByText("동시 수정 진행", { exact: true }).waitFor();
  await second.getByText("다른 탭 회의 결정", { exact: true }).waitFor();
  assert.equal(
    await second.locator(".meeting-report-table textarea").count(),
    0,
  );
  await second.close();
  await page.screenshot({ path: "/tmp/azla-v03-meeting.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.getByRole("tab", { name: "회의 녹음 내용", exact: true }).click();
  await page.screenshot({
    path: "/tmp/azla-v03-recordings.png",
    fullPage: true,
  });
  const denied = await browser.newContext();
  const dp = await denied.newPage();
  await dp.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await dp.goto(base);
  await dp.getByRole("button", { name: "새 주간회의", exact: true }).click();
  await dp.getByRole("button", { name: "저장하고 닫기" }).click();
  await dp.getByRole("button", { name: "회의 시작", exact: true }).click();
  await dp
    .getByRole("dialog", { name: "회의 녹음 시작" })
    .getByRole("checkbox")
    .check();
  await dp.getByRole("button", { name: "동의하고 녹음 시작" }).click();
  await dp.getByRole("alert").filter({ hasText: "마이크 권한" }).waitFor();
  assert.equal(
    await dp.getByRole("button", { name: "회의 종료", exact: true }).count(),
    0,
  );
  await denied.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: concurrent content editing, mobile layout, microphone denial and zero browser errors.",
  );
} finally {
  await browser.close();
}
