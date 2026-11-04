import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  boardSchema,
  carryMeeting,
  emptyBoard,
  newAgenda,
  newMeeting,
  reviewVisual,
  type Visual,
} from "../lib/conference";
import { mergeBoards, MergeConflict } from "../lib/conference-merge";
function fixture() {
  const m = newMeeting("2026-11-02");
  m.agenda = [newAgenda("제품 A"), newAgenda("제품 B")];
  return { ...emptyBoard(), meetings: [m] };
}
test("different owners editing separate agenda fields merge without losing either report", () => {
  const base = fixture();
  const local = structuredClone(base);
  local.meetings[0].agenda[0].report = "담당자 A 업무";
  const remote = structuredClone(base);
  remote.meetings[0].agenda[1].report = "담당자 B 업무";
  const result = mergeBoards(base, local, remote);
  assert.equal(result.meetings[0].agenda[0].report, "담당자 A 업무");
  assert.equal(result.meetings[0].agenda[1].report, "담당자 B 업무");
});
test("different fields of the same agenda merge; competing edits of the same field require review", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.meetings[0].agenda[0].report = "금주 보고";
  remote.meetings[0].agenda[0].plan = "차주 계획";
  assert.equal(
    mergeBoards(base, local, remote).meetings[0].agenda[0].plan,
    "차주 계획",
  );
  remote.meetings[0].agenda[0].report = "다른 보고";
  assert.throws(() => mergeBoards(base, local, remote), MergeConflict);
});
test("next week carries reports and the existing unfinished task IDs, never prior approvals", () => {
  const b = fixture(),
    m = b.meetings[0];
  m.agenda[0].report = "샘플 검토";
  let withTasks = addTask(b, m.id, {
    title: "색상 확인",
    product: "제품 A",
    owner: "담당자",
    due: "",
    status: "doing",
  });
  withTasks = addTask(withTasks, m.id, {
    title: "완료 업무",
    product: "제품 A",
    owner: "",
    due: "",
    status: "done",
  });
  const next = carryMeeting(withTasks, m, "2026-11-09");
  assert.equal(next.meetings[0].agenda[0].previous, "샘플 검토");
  assert.equal(next.meetings[0].agenda[0].report, "");
  assert.equal(next.tasks.length, 2);
  assert.equal(next.tasks[0].id, withTasks.tasks[0].id);
  assert.equal(next.tasks[0].meetingIds.length, 2);
  assert.equal(next.tasks[1].meetingIds.length, 1);
});
test("task registration retries link an existing unfinished task instead of duplicating it", () => {
  const b = fixture();
  const t = {
    title: "  색상 확인 ",
    product: "제품 A",
    owner: "담당자",
    due: "",
    status: "todo" as const,
  };
  const once = addTask(b, b.meetings[0].id, t);
  const twice = addTask(once, b.meetings[0].id, t);
  assert.equal(twice.tasks.length, 1);
  assert.equal(twice.tasks[0].meetingIds.length, 1);
});
test("design approval keeps immutable review events and requires specific feedback for changes", () => {
  const v: Visual = {
    id: crypto.randomUUID(),
    path: "test",
    name: "design.png",
    mime: "image/png",
    size: 10,
    label: "시안 A",
    status: "pending",
    comment: "",
    reviewer: "",
    reviewedAt: "",
    history: [],
  };
  assert.throws(() => reviewVisual(v, "changes", "", "검토자"));
  assert.throws(() => reviewVisual(v, "approved", "좋음", ""));
  const first = reviewVisual(v, "changes", "로고 위치 조정", "검토자");
  const second = reviewVisual(first, "approved", "수정 확인", "검토자");
  assert.equal(v.history.length, 0);
  assert.equal(second.history.length, 2);
  assert.equal(second.history[0].status, "changes");
  assert.equal(second.status, "approved");
});
test("meeting finalization requires explicit review and unique IDs", () => {
  const b = fixture();
  b.meetings[0].status = "final";
  assert.equal(boardSchema.safeParse(b).success, false);
  b.meetings[0].reviewed = true;
  assert.equal(boardSchema.safeParse(b).success, true);
  b.meetings[0].agenda.push(b.meetings[0].agenda[0]);
  assert.equal(boardSchema.safeParse(b).success, false);
});

test("saved attachment paths cannot traverse into legacy/private buckets and executable file types are rejected", () => {
  const b = fixture();
  const valid: Visual = {
    id: crypto.randomUUID(),
    path: `azla/${crypto.randomUUID()}.png`,
    name: "design.png",
    mime: "image/png",
    size: 10,
    label: "시안",
    status: "pending",
    comment: "",
    reviewer: "",
    reviewedAt: "",
    history: [],
  };
  b.meetings[0].agenda[0].visuals = [valid];
  assert.equal(boardSchema.safeParse(b).success, true);
  valid.path = "../../meeting-files/secret.pdf";
  assert.equal(boardSchema.safeParse(b).success, false);
  valid.path = `azla/${crypto.randomUUID()}.png`;
  valid.mime = "text/html";
  assert.equal(boardSchema.safeParse(b).success, false);
});
