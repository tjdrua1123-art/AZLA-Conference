import { aiSchema, type AIDraft } from "./ai";
import { recordingDraftSchema, type Recording } from "./conference";
export type AIRequest = (body: {
  kind: "transcribe" | "summary";
  meeting_id: string;
  attachment_id?: string;
  notes?: string;
  transcript?: string;
  consent: boolean;
}) => Promise<{ text?: string; draft?: AIDraft }>;
export function transcriptChunks(text: string, max = 24000): string[] {
  const parts: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(text.length, offset + max);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > offset + max / 2) end = boundary;
    }
    parts.push(text.slice(offset, end));
    offset = end;
  }
  return parts;
}
export async function summarizeRecording(options: {
  meetingId: string;
  recording: Recording;
  notes: string;
  request: AIRequest;
  checkpoint: (r: Recording) => Promise<void>;
  signal?: AbortSignal;
}): Promise<Recording> {
  let current = {
    ...options.recording,
    status: "processing" as const,
    error: "",
  };
  for (const part of current.parts) {
    options.signal?.throwIfAborted();
    if (current.transcribedPartIds.includes(part.id)) continue;
    const result = await options.request({
      kind: "transcribe",
      meeting_id: options.meetingId,
      attachment_id: part.id,
      consent: current.consent,
    });
    if (typeof result.text !== "string" || !result.text.trim())
      throw new Error(
        "전사 결과가 비어 있습니다. 원본 녹음을 확인한 뒤 다시 정리해 주세요.",
      );
    current = {
      ...current,
      transcript: [current.transcript, result.text]
        .filter(Boolean)
        .join("\n\n"),
      transcribedPartIds: [...current.transcribedPartIds, part.id],
    };
    await options.checkpoint(current);
  }
  if (!current.transcript.trim())
    throw new Error("정리할 전사 내용이 없습니다.");
  const combined: AIDraft = {
    summary: [],
    discussion: [],
    decisions: [],
    tasks: [],
  };
  for (const [i, chunk] of transcriptChunks(current.transcript).entries()) {
    options.signal?.throwIfAborted();
    const result = await options.request({
      kind: "summary",
      meeting_id: options.meetingId,
      notes: i === 0 ? options.notes : "",
      transcript: chunk,
      consent: current.consent,
    });
    const draft = aiSchema.parse(result.draft);
    for (const key of ["summary", "discussion", "decisions", "tasks"] as const)
      (combined[key] as unknown[]).push(...draft[key]);
  }
  const draft = recordingDraftSchema.parse(combined);
  const finished: Recording = {
    ...current,
    draft,
    status: "ready",
    reviewed: false,
    error: "",
  };
  await options.checkpoint(finished);
  return finished;
}
