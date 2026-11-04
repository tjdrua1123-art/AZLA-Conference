import { test } from "node:test";
import assert from "node:assert/strict";
import { filterMeetings, nextMonday, canWrite } from "../lib/types";
import { demoMeetings } from "../lib/demo";
import { validateEvidence } from "../lib/ai";
test("Korean week scheduling uses Monday and handles Sunday/year boundaries", () => {
  assert.equal(nextMonday(new Date("2026-11-01T13:00:00Z")), "2026-11-02");
  assert.equal(nextMonday(new Date("2026-11-02T01:00:00Z")), "2026-11-02");
  assert.equal(nextMonday(new Date("2026-12-31T01:00:00Z")), "2027-01-04");
});
test("meeting searches combine keyword, product, and date", () => {
  assert.equal(
    filterMeetings(demoMeetings, "샘플", "SEDNAEARFIT", "2026-11-02").length,
    1,
  );
  assert.equal(
    filterMeetings(demoMeetings, "샘플", "CRYSTAL", "2026-11-02").length,
    0,
  );
});
test("inactive staff and viewers cannot write", () => {
  assert.equal(
    canWrite({ id: "x", name: "직원", active: false, role: "admin" }),
    false,
  );
  assert.equal(
    canWrite({ id: "x", name: "직원", active: true, role: "viewer" }),
    false,
  );
});
test("AI rejects invented evidence; clears owner/date not supported by evidence", () => {
  const data = {
    summary: [{ text: "측정 진행", evidence: "샘플 측정 예정" }],
    discussion: [],
    decisions: [],
    tasks: [
      {
        title: "측정",
        owner: "홍길동",
        due_date: "2026-11-09",
        evidence: "샘플 측정 예정",
      },
    ],
  };
  const result = validateEvidence(data, "메모: 샘플 측정 예정");
  assert.equal(result.tasks[0].owner, null);
  assert.equal(result.tasks[0].due_date, null);
  assert.throws(() => validateEvidence(data, "해당 내용은 존재하지 않음"));
});
