import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://localhost:3200";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
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
  await page.getByRole("button", { name: "새 주간회의", exact: true }).click();
  const meta = page.getByRole("dialog", { name: "회의 정보" });
  await meta.getByLabel("회의 제목").fill("주간회의 가독성 검증");
  await meta.getByLabel("회의 날짜").fill("2026-11-04");
  await meta.getByRole("button", { name: "저장하고 닫기" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "회의 내용을 저장했습니다." })
    .waitFor();
  async function stored() {
    return page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open("azla-conference-v2", 1);
          r.onsuccess = () => {
            const db = r.result;
            const q = db.transaction("state").objectStore("state").get("board");
            q.onsuccess = () => {
              resolve(q.result);
              db.close();
            };
          };
        }),
    );
  }
  const report = Array.from(
    { length: 12 },
    (_, i) =>
      `${i + 1}. 샘플 진행 내용을 확인하고 필요한 변경 사항을 기록합니다.`,
  ).join("\n");
  await page.getByRole("button", { name: "안건 등록", exact: true }).click();
  let dialog = page.locator(".entry-fullscreen");
  await dialog.getByLabel("안건 제목", { exact: true }).fill("샘플 개발 현황");
  await dialog.getByLabel("제품명", { exact: true }).fill("제품 A");
  await dialog.getByLabel("진행 내용", { exact: true }).fill(report);
  assert.equal(
    await dialog.getByLabel("다음 계획", { exact: true }).count(),
    0,
  );
  await dialog
    .getByLabel("회의 결정", { exact: true })
    .fill("수정 시안 검토 후 진행");
  await dialog
    .getByLabel("첨부파일 선택", { exact: true })
    .setInputFiles({ name: "참고.png", mimeType: "image/png", buffer: png });
  await dialog
    .getByRole("button", { name: "참고.png 첨부 취소", exact: true })
    .waitFor();
  const layout = await dialog.evaluate((el) => {
    const form = el.querySelector("form");
    const boxes = [...el.querySelectorAll(".entry-writing-panel textarea")].map(
      (x) => x.getBoundingClientRect(),
    );
    const footer = el
      .querySelector(".entry-fixed-footer")
      .getBoundingClientRect();
    return {
      formScroll: form.scrollHeight - form.clientHeight,
      boxes: boxes.map((b) => ({
        top: b.top,
        bottom: b.bottom,
        width: b.width,
      })),
      footerBottom: footer.bottom,
      height: innerHeight,
    };
  });
  assert.ok(layout.formScroll <= 2);
  assert.equal(layout.boxes.length, 2);
  assert.ok(layout.boxes[0].width > layout.boxes[1].width * 2);
  assert.ok(
    Math.max(...layout.boxes.map((b) => b.top)) -
      Math.min(...layout.boxes.map((b) => b.top)) <
      2,
  );
  assert.ok(
    layout.boxes.every((b) => b.bottom < layout.footerBottom && b.width > 200),
  );
  assert.ok(layout.footerBottom <= layout.height);
  function contrastOnWhite(rgb) {
    const channels = rgb
      .match(/\d+/g)
      .slice(0, 3)
      .map((x) => {
        const n = Number(x) / 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
    return (
      1.05 /
      (channels[0] * 0.2126 +
        channels[1] * 0.7152 +
        channels[2] * 0.0722 +
        0.05)
    );
  }
  const inputColor = await dialog
    .getByLabel("진행 내용", { exact: true })
    .evaluate((el) => getComputedStyle(el).color);
  assert.ok(contrastOnWhite(inputColor) >= 7);
  await page.screenshot({ path: "/tmp/azla-v05-editor.png", fullPage: true });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await dialog
    .getByRole("status")
    .filter({ hasText: "저장했습니다." })
    .waitFor();
  assert.equal(
    await dialog.getByLabel("진행 내용", { exact: true }).inputValue(),
    report,
  );
  await dialog
    .getByLabel("회의 결정", { exact: true })
    .fill("기존 첨부를 유지하면서 결정 수정");
  await page.keyboard.press("Control+s");
  await dialog
    .getByRole("status")
    .filter({ hasText: "저장했습니다." })
    .waitFor();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  let state = await stored();
  assert.equal(state.data.meetings[0].agenda[0].visuals.length, 1);
  // Load an actual previous-version record, then verify the removed field is retained.
  state.data.meetings[0].agenda[0].plan = "이전 버전에서 입력한 계획 원문";
  await page.evaluate(
    (board) =>
      new Promise((resolve) => {
        const request = indexedDB.open("azla-conference-v2", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(board, "board");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    state,
  );
  await page.reload();
  await page.locator(".legacy-plan summary").click();
  await page
    .getByText("이전 버전에서 입력한 계획 원문", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("columnheader", { name: "다음 계획", exact: true })
      .count(),
    0,
  );
  const sourceId = state.data.meetings[0].id;
  const sourceAgenda = structuredClone(state.data.meetings[0].agenda[0]);
  const reportColor = await page
    .locator(".project-progress .readable-lines p")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  assert.ok(contrastOnWhite(reportColor) >= 7);
  const clipped = page.locator(".project-progress .readable-lines").first();
  assert.ok(await clipped.evaluate((el) => el.scrollHeight > el.clientHeight));
  await page
    .getByRole("button", { name: "내용 펼치기", exact: true })
    .first()
    .click();
  assert.ok(
    await clipped.evaluate((el) => el.scrollHeight - el.clientHeight <= 1),
  );
  await page.getByRole("button", { name: "접기", exact: true }).first().click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
    true,
  );
  await page.getByRole("button", { name: "안건 등록", exact: true }).click();
  dialog = page.locator(".entry-fullscreen");
  await dialog.getByLabel("안건 제목", { exact: true }).fill("삭제 대상 안건");
  await dialog
    .getByLabel("진행 내용", { exact: true })
    .fill("전주에서 삭제할 기록");
  await dialog
    .getByRole("button", { name: "저장 후 닫기", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "삭제 대상 안건 삭제", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "안건을 삭제했습니다." })
    .waitFor();
  assert.equal(
    await page.getByText("삭제 대상 안건", { exact: true }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "다음 회의 만들기", exact: true })
    .click();
  let schedule = page.getByRole("dialog", {
    name: "다음 회의 만들기",
    exact: true,
  });
  await schedule.getByLabel("회의 날짜").fill("2026-11-13");
  await schedule.getByRole("button", { name: "취소", exact: true }).click();
  assert.equal((await stored()).data.meetings.length, 1);
  await page
    .getByRole("button", { name: "다음 회의 만들기", exact: true })
    .click();
  schedule = page.getByRole("dialog", {
    name: "다음 회의 만들기",
    exact: true,
  });
  await schedule.getByLabel("회의 날짜").fill("2026-11-13");
  await schedule
    .getByRole("button", { name: "내용 이어서 만들기", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({
      hasText: "이전 진행 내용·회의 결정·첨부자료를 이어받아 저장했습니다.",
    })
    .waitFor();
  state = await stored();
  const copy = state.data.meetings[0];
  assert.equal(copy.date, "2026-11-13");
  assert.equal(copy.agenda.length, 1);
  assert.equal(copy.agenda[0].report, report);
  assert.equal(copy.agenda[0].plan, sourceAgenda.plan);
  assert.equal(copy.agenda[0].decision, sourceAgenda.decision);
  assert.equal(copy.agenda[0].visuals[0].path, sourceAgenda.visuals[0].path);
  assert.notEqual(copy.agenda[0].visuals[0].id, sourceAgenda.visuals[0].id);
  assert.equal(copy.recordings.length, 0);
  await page
    .getByRole("button", { name: "샘플 개발 현황 수정", exact: true })
    .click();
  dialog = page.locator(".entry-fullscreen");
  await dialog
    .getByRole("button", { name: "이전 회의와 비교", exact: true })
    .click();
  assert.equal(
    await dialog.getByLabel("이전 회의 내용", { exact: true }).inputValue(),
    report,
  );
  const sourceColor = await dialog
    .getByLabel("이전 회의 내용", { exact: true })
    .evaluate((el) => getComputedStyle(el).color);
  assert.ok(contrastOnWhite(sourceColor) >= 7);
  await dialog
    .getByLabel("이번 회의 비교 수정", { exact: true })
    .fill(report + "\n새로운 수정 사항");
  await dialog.getByRole("button", { name: "입력 화면", exact: true }).click();
  await dialog
    .getByRole("button", { name: "저장 후 닫기", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok((await page.locator(".changed-line").count()) > 0);
  assert.equal(
    await page.locator(".project-state.changed").textContent(),
    "변경 1곳",
  );
  const excerpt = page.locator(".project-progress .changed-excerpt");
  await excerpt.waitFor();
  assert.equal((await excerpt.textContent()).trim(), "새로운 수정 사항");
  await page
    .locator(".project-progress")
    .getByRole("button", { name: "내용 펼치기", exact: true })
    .click();
  assert.ok(
    (
      await page.locator(".project-progress .readable-lines").textContent()
    ).includes(report.replaceAll("\n", "")),
  );
  await page
    .locator(".project-progress")
    .getByRole("button", { name: "접기", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "샘플 개발 현황 이전 회의와 비교",
      exact: true,
    })
    .click();
  await page.getByRole("dialog", { name: "이전 회의 변경 비교" }).waitFor();
  await page
    .getByRole("button", { name: "변경 비교 닫기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "회의 정보 수정", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "회의 정보" })
    .getByLabel("회의 날짜")
    .fill("2026-11-17");
  await page
    .getByRole("dialog", { name: "회의 정보" })
    .getByRole("button", { name: "저장하고 닫기" })
    .click();
  await page
    .getByRole("dialog", { name: "회의 정보" })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("combobox", { name: "회의 선택", exact: true })
    .selectOption(sourceId);
  await page
    .getByRole("button", { name: "다음 회의 만들기", exact: true })
    .click();
  schedule = page.getByRole("dialog", {
    name: "다음 회의 만들기",
    exact: true,
  });
  assert.equal(
    await schedule.getByLabel("회의 날짜").inputValue(),
    "2026-11-17",
  );
  await schedule
    .getByRole("button", { name: "내용 이어서 만들기", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "이미 만들어진 회의를 열었습니다." })
    .waitFor();
  state = await stored();
  assert.equal(state.data.meetings.length, 2);
  assert.equal(state.data.meetings[0].date, "2026-11-17");
  assert.equal(
    state.data.meetings[0].agenda[0].report,
    report + "\n새로운 수정 사항",
  );
  assert.equal(
    state.data.meetings.find((m) => m.id === sourceId).agenda[0].report,
    report,
  );
  await page
    .getByRole("button", { name: "샘플 개발 현황 삭제", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "안건을 삭제했습니다." })
    .waitFor();
  assert.equal(
    await page.getByText("샘플 개발 현황", { exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "삭제한 안건", exact: true }).click();
  await page
    .getByRole("button", { name: "샘플 개발 현황 복원", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "안건과 첨부자료를 복원했습니다." })
    .waitFor();
  await page
    .getByRole("button", { name: "삭제한 안건 닫기", exact: true })
    .click();
  await page.getByRole("button", { name: "참고 확대", exact: true }).waitFor();
  assert.equal(
    await page.getByText("샘플 개발 현황", { exact: true }).count(),
    1,
  );
  state = await stored();
  assert.equal(
    state.data.meetings.find((m) => m.id === sourceId).agenda[0].deletedAt,
    undefined,
  );
  assert.equal(state.data.meetings[0].agenda[0].visuals.length, 1);
  await page.screenshot({ path: "/tmp/azla-v05-sheet.png", fullPage: true });
  await page.reload();
  await page
    .getByRole("button", { name: "샘플 개발 현황 수정", exact: true })
    .click();
  dialog = page.locator(".entry-fullscreen");
  assert.equal(
    await dialog.getByLabel("진행 내용", { exact: true }).inputValue(),
    report + "\n새로운 수정 사항",
  );
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  for (const [title, product, progress, decision] of [
    [
      "금형 샘플 검토",
      "제품 B",
      "1차 샘플 조립 확인 완료\n체결부 유격 개선안 검토 중\n수정 시안은 첨부 자료로 비교",
      "수정 방향 확인 후 2차 샘플 진행",
    ],
    [
      "회로 검증 진행",
      "제품 C",
      "측정 결과 취합 완료\n노이즈 원인 비교 측정 중",
      "",
    ],
  ]) {
    await page.getByRole("button", { name: "안건 등록", exact: true }).click();
    const entry = page.getByRole("dialog", { name: "안건 등록", exact: true });
    await entry.getByLabel("안건 제목", { exact: true }).fill(title);
    await entry.getByLabel("제품명", { exact: true }).fill(product);
    await entry.getByLabel("진행 내용", { exact: true }).fill(progress);
    await entry.getByLabel("회의 결정", { exact: true }).fill(decision);
    await entry
      .getByRole("button", { name: "저장 후 닫기", exact: true })
      .click();
    await entry.waitFor({ state: "hidden" });
  }
  const navigator = page.getByRole("navigation", { name: "프로젝트 바로가기" });
  assert.equal(await navigator.getByRole("button").count(), 3);
  await navigator.getByRole("button").last().click();
  assert.equal(
    await page.locator(".meeting-page").evaluate((el) => el.scrollTop),
    0,
  );
  assert.ok(
    await page
      .locator(".meeting-tabs")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top >=
          document.querySelector(".meeting-app-header").getBoundingClientRect()
            .bottom,
      ),
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "제품 C 프로젝트",
  );
  assert.equal(await page.locator(".project-decision.recorded").count(), 2);
  await page.locator(".decision-placeholder").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight + 1,
    ),
    true,
  );
  await navigator.getByRole("button").first().click();
  // Printing must include the original report, not only the changed excerpt.
  await page.emulateMedia({ media: "print" });
  await page
    .locator(".project-progress .readable-lines")
    .first()
    .waitFor({ state: "visible" });
  assert.ok(
    (
      await page
        .locator(".project-progress .readable-lines")
        .first()
        .textContent()
    ).includes(report.replaceAll("\n", "")),
  );
  assert.equal(
    await page.locator(".project-progress .changed-excerpt").isVisible(),
    false,
  );
  await page.emulateMedia({ media: "screen" });
  await page
    .locator(".project-list")
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: "/tmp/azla-project-overview.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "/tmp/azla-project-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: project overview/navigation, changed-lines-first with full print preservation, wide high-contrast editor, flexible meeting dates, persistent save/Ctrl+S, readable expansion, complete weekly copy, prior-week comparison, duplicate preparation protection, soft delete/restore, original preservation and attachment availability.",
  );
} finally {
  await browser.close();
}
