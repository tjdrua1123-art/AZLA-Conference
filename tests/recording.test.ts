import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardSchema,
  conferenceTabs,
  emptyBoard,
  newMeeting,
  type Recording,
  type Visual,
} from "../lib/conference";
import {
  summarizeRecording,
  transcriptChunks,
  type AIRequest,
} from "../lib/recording-pipeline";
import type { AIDraft } from "../lib/ai";
function part(): Visual {
  return {
    id: crypto.randomUUID(),
    path: crypto.randomUUID(),
    name: "part.webm",
    mime: "audio/webm",
    size: 100,
    label: "녹음",
    status: "pending",
    comment: "",
    reviewer: "",
    reviewedAt: "",
    history: [],
  };
}
function recording(): Recording {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationSeconds: 60,
    status: "processing",
    consent: true,
    parts: [part(), part()],
    transcribedPartIds: [],
    transcript: "",
    draft: null,
    error: "",
    reviewed: false,
  };
}
const draft: AIDraft = {
  summary: [{ text: "샘플 검토", evidence: "샘플 확인" }],
  discussion: [],
  decisions: [],
  tasks: [],
};
test("six tabs have exact requested order, with no all category", () => {
  assert.deepEqual(conferenceTabs, [
    "development",
    "design",
    "production",
    "pending",
    "stopped",
    "recordings",
  ]);
});
test("legacy meetings load with empty recording list without a database reset", () => {
  const m = newMeeting();
  const legacy: Record<string, unknown> = { ...m };
  delete legacy.recordings;
  const parsed = boardSchema.parse({ ...emptyBoard(), meetings: [legacy] });
  assert.deepEqual(parsed.meetings[0].recordings, []);
});
test("end-of-meeting pipeline saves every transcription before the final combined summary", async () => {
  const r = recording();
  const checkpoints: Recording[] = [];
  const calls: string[] = [];
  const request: AIRequest = async (b) => {
    calls.push(b.kind);
    return b.kind === "transcribe" ? { text: "샘플 확인" } : { draft };
  };
  const done = await summarizeRecording({
    meetingId: crypto.randomUUID(),
    recording: r,
    notes: "",
    request,
    checkpoint: async (next) => {
      checkpoints.push(structuredClone(next));
    },
  });
  assert.deepEqual(calls, ["transcribe", "transcribe", "summary"]);
  assert.equal(checkpoints.length, 3);
  assert.equal(checkpoints[0].transcribedPartIds.length, 1);
  assert.equal(checkpoints[1].transcribedPartIds.length, 2);
  assert.equal(done.status, "ready");
  assert.deepEqual(done.draft, draft);
  assert.equal(done.reviewed, false);
  assert.equal(r.transcribedPartIds.length, 0);
});
test("retry resumes at the first untranscribed segment and retains original audio after an AI failure", async () => {
  const r = recording();
  let checkpoint = r;
  let count = 0;
  await assert.rejects(
    () =>
      summarizeRecording({
        meetingId: crypto.randomUUID(),
        recording: r,
        notes: "",
        request: async (b) => {
          if (++count === 2) throw new Error("provider timeout");
          return { text: "샘플 확인" };
        },
        checkpoint: async (next) => {
          checkpoint = structuredClone(next);
        },
      }),
    /provider timeout/,
  );
  assert.equal(checkpoint.parts.length, 2);
  assert.equal(checkpoint.transcribedPartIds.length, 1);
  const called: string[] = [];
  const finished = await summarizeRecording({
    meetingId: crypto.randomUUID(),
    recording: checkpoint,
    notes: "",
    request: async (b) => {
      called.push(b.kind);
      return b.kind === "transcribe" ? { text: "샘플 확인" } : { draft };
    },
    checkpoint: async () => {},
  });
  assert.deepEqual(called, ["transcribe", "summary"]);
  assert.equal(finished.status, "ready");
});
test("long transcripts are summarized in bounded chunks and preserve all source characters", () => {
  const source = "가".repeat(28000) + "\n" + "나".repeat(30000);
  const parts = transcriptChunks(source);
  assert.equal(parts.join(""), source);
  assert.ok(parts.every((s) => s.length <= 24000));
  assert.ok(parts.length > 1);
});
test("an empty transcription cannot be silently marked ready", async () => {
  const r = recording();
  await assert.rejects(
    () =>
      summarizeRecording({
        meetingId: crypto.randomUUID(),
        recording: r,
        notes: "",
        request: async () => ({ text: "" }),
        checkpoint: async () => {},
      }),
    /전사 결과가 비어/,
  );
});
