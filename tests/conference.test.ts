import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  boardSchema,
  carryMeeting,
  deleteAgenda,
  restoreAgenda,
  previousAgenda,
  agendaChangedFields,
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
test("next week preserves editable reports and links existing unfinished tasks", () => {
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
  assert.equal(next.meetings[0].agenda[0].report, "샘플 검토");
  assert.equal(
    previousAgenda(next, next.meetings[0].agenda[0])?.report,
    "샘플 검토",
  );
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

test("weekly copies preserve reports, plans, decisions and files independently without duplicating an existing prepared week", () => {
  const b = fixture();
  const source = b.meetings[0];
  const item = source.agenda[0];
  item.report = "이전 보고";
  item.plan = "기존 계획";
  item.decision = "기존 결정";
  item.visuals = [
    {
      id: crypto.randomUUID(),
      path: crypto.randomUUID(),
      name: "design.png",
      mime: "image/png",
      size: 10,
      label: "시안",
      status: "approved",
      comment: "기존 승인",
      reviewer: "검토자",
      reviewedAt: "2026-11-02T01:00:00.000Z",
      history: [],
    },
  ];
  const next = carryMeeting(b, source, "2026-11-09");
  const copy = next.meetings[0].agenda[0];
  assert.equal(copy.report, item.report);
  assert.equal(copy.plan, item.plan);
  assert.equal(copy.decision, item.decision);
  assert.notEqual(copy.id, item.id);
  assert.notEqual(copy.visuals[0].id, item.visuals[0].id);
  assert.equal(copy.visuals[0].path, item.visuals[0].path);
  assert.ok(copy.visuals[0].carriedFrom);
  assert.deepEqual(agendaChangedFields(copy, item), []);
  copy.report = "이번 주 수정";
  copy.visuals[0].comment = "추가 메모";
  assert.equal(item.report, "이전 보고");
  assert.equal(item.visuals[0].comment, "기존 승인");
  const again = carryMeeting(next, source, "2026-11-09");
  assert.equal(again.meetings.length, 2);
  assert.equal(again.meetings[0].agenda[0].report, "이번 주 수정");
  assert.equal(boardSchema.safeParse(again).success, true);
  again.meetings[0].date = "2026-11-10";
  const rescheduled = carryMeeting(again, source, "2026-11-09");
  assert.equal(rescheduled.meetings.length, 2);
  assert.equal(rescheduled.meetings[0].date, "2026-11-10");
  assert.equal(boardSchema.safeParse(rescheduled).success, true);
  const reviewed = reviewVisual(
    copy.visuals[0],
    "approved",
    "재검토",
    "검토자",
  );
  assert.equal(reviewed.carriedFrom, undefined);
  assert.ok(copy.visuals[0].carriedFrom);
});

test("deletion is scoped to one week, restorable with files intact, excluded from future carry and conflicts with concurrent edits", () => {
  const b = fixture();
  const source = b.meetings[0];
  const original = source.agenda[0];
  original.report = "보존할 보고";
  const next = carryMeeting(b, source, "2026-11-09");
  const copied = next.meetings[0];
  const deleted = deleteAgenda(next, copied.id, copied.agenda[0].id);
  assert.equal(
    deleted.meetings.find((m) => m.id === source.id)!.agenda[0].deletedAt,
    undefined,
  );
  assert.equal(deleted.meetings[0].agenda[0].report, "보존할 보고");
  const future = carryMeeting(deleted, deleted.meetings[0], "2026-11-16");
  assert.equal(future.meetings[0].agenda.length, 1);
  const restored = restoreAgenda(deleted, copied.id, copied.agenda[0].id);
  assert.equal(restored.meetings[0].agenda[0].deletedAt, undefined);
  assert.equal(restored.meetings[0].agenda[0].report, "보존할 보고");
  const remote = structuredClone(next);
  remote.meetings[0].agenda[0].report = "다른 직원의 수정";
  assert.throws(() => mergeBoards(next, deleted, remote), MergeConflict);
});

test("two staff preparing the same week merge into one prepared meeting even after JSON object-key reordering", () => {
  const base = fixture();
  const first = carryMeeting(base, base.meetings[0], "2026-11-09");
  const second = carryMeeting(
    structuredClone(base),
    structuredClone(base.meetings[0]),
    "2026-11-09",
  );
  assert.equal(first.meetings[0].id, second.meetings[0].id);
  assert.equal(first.meetings[0].agenda[0].id, second.meetings[0].agenda[0].id);
  const reversed = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reversed)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reversed(v)]),
          )
        : value;
  const remote = boardSchema.parse(reversed(first));
  const merged = mergeBoards(base, second, remote);
  assert.equal(merged.meetings.length, 2);
  assert.equal(merged.meetings[0].id, first.meetings[0].id);
});
