import { z } from "zod";
import { v5 as uuidV5 } from "uuid";
import { todayInSeoul } from "./types";
import { aiSchema } from "./ai";
export const reviewLabels = {
  pending: "검토 대기",
  approved: "승인",
  changes: "수정 요청",
} as const;
export type ReviewStatus = keyof typeof reviewLabels;
export const categoryLabels = {
  development: "신제품개발",
  design: "디자인",
  production: "생산관련업데이트",
  pending: "보류",
  stopped: "중단",
} as const;
export type Category = keyof typeof categoryLabels;
export const conferenceTabs = [
  ...Object.keys(categoryLabels),
  "recordings",
] as (Category | "recordings")[];
export function isCategory(value: string): value is Category {
  return value in categoryLabels;
}
const uid = z.uuid();
const short = z.string().max(500);
export const visualSchema = z.object({
  carriedFrom: z.object({ date: z.iso.date(), visualId: uid }).optional(),
  sequence: z.number().int().nonnegative().optional(),
  id: uid,
  name: short,
  path: z
    .string()
    .regex(
      /^(?:[a-f0-9-]{36}|azla\/[a-f0-9-]{36}\.(?:jpg|png|webp|pdf|webm|mp4|mp3|wav|ogg))$/i,
    ),
  mime: z
    .string()
    .max(100)
    .refine((value) => fileMimes.includes(value)),
  size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  label: short,
  status: z.enum(["pending", "approved", "changes"]),
  comment: z.string().max(10000),
  reviewer: short,
  reviewedAt: z.string(),
  history: z
    .array(
      z.object({
        status: z.enum(["pending", "approved", "changes"]),
        comment: z.string().max(10000),
        reviewer: short,
        at: z.string(),
      }),
    )
    .max(300),
});
export type Visual = z.infer<typeof visualSchema>;
export const agendaSchema = z.object({
  deletedAt: z.iso.datetime().optional(),
  carriedFrom: z
    .object({ meetingId: uid, agendaId: uid, date: z.iso.date() })
    .optional(),
  id: uid,
  title: short,
  product: short,
  category: z.enum([
    "development",
    "production",
    "design",
    "stopped",
    "partner",
    "pending",
    "other",
  ]),
  partner: short,
  owner: short,
  previous: z.string().max(60000),
  report: z.string().max(60000),
  plan: z.string().max(30000),
  decision: z.string().max(30000),
  source: short,
  visuals: z.array(visualSchema).max(300),
});
export type Agenda = z.infer<typeof agendaSchema>;
export const workTaskSchema = z.object({
  id: uid,
  title: z.string().min(1).max(500),
  product: short,
  owner: short,
  due: z.union([z.literal(""), z.iso.date()]),
  status: z.enum(["todo", "doing", "done"]),
  meetingIds: z.array(uid).max(1000),
});
export type WorkTask = z.infer<typeof workTaskSchema>;
export const recordingDraftSchema = aiSchema.extend({
  summary: aiSchema.shape.summary.max(200),
  discussion: aiSchema.shape.discussion.max(300),
  decisions: aiSchema.shape.decisions.max(300),
  tasks: aiSchema.shape.tasks.max(300),
});
export const recordingSchema = z.object({
  id: uid,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationSeconds: z.number().nonnegative(),
  status: z.enum(["recording", "processing", "ready", "needs_setup", "failed"]),
  consent: z.boolean(),
  parts: z.array(visualSchema).max(300),
  transcribedPartIds: z.array(uid).max(300),
  transcript: z.string().max(600000),
  draft: recordingDraftSchema.nullable(),
  error: z.string().max(2000),
  reviewed: z.boolean(),
});
export type Recording = z.infer<typeof recordingSchema>;
export function meetingFiles(meeting: Session): Visual[] {
  return [
    ...meeting.agenda.flatMap((a) => a.visuals),
    ...meeting.recordings.flatMap((r) => r.parts),
  ];
}
export const sessionSchema = z.object({
  copiedFrom: uid.optional(),
  id: uid,
  title: z.string().min(1).max(200),
  date: z.iso.date(),
  department: short,
  attendees: short,
  status: z.enum(["draft", "final"]),
  notes: z.string().max(30000),
  transcript: z.string().max(60000),
  reviewed: z.boolean(),
  agenda: z.array(agendaSchema).max(300),
  recordings: z.array(recordingSchema).max(200).default([]),
});
export type Session = z.infer<typeof sessionSchema>;
export const boardSchema = z
  .object({
    schema: z.literal(2),
    meetings: z.array(sessionSchema).max(1000),
    tasks: z.array(workTaskSchema).max(10000),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const meetings = new Set(value.meetings.map((m) => m.id));
    for (const m of value.meetings) {
      if (m.status === "final" && !m.reviewed)
        ctx.addIssue({
          code: "custom",
          message: "검토 확인 후 확정할 수 있습니다.",
        });
      for (const id of [
        m.id,
        ...m.agenda.flatMap((a) => [a.id, ...a.visuals.map((v) => v.id)]),
        ...m.recordings.flatMap((r) => [r.id, ...r.parts.map((p) => p.id)]),
      ]) {
        if (ids.has(id)) ctx.addIssue({ code: "custom", message: "중복 ID" });
        ids.add(id);
      }
    }
    for (const t of value.tasks) {
      if (ids.has(t.id))
        ctx.addIssue({ code: "custom", message: "중복 업무 ID" });
      ids.add(t.id);
      if (t.meetingIds.some((id) => !meetings.has(id)))
        ctx.addIssue({ code: "custom", message: "존재하지 않는 회의 연결" });
    }
  });
export type Board = z.infer<typeof boardSchema>;
export type StoredBoard = { version: number; data: Board };
export type Snapshot = { version: number; data: Board; created_at: string };
export function emptyBoard(): Board {
  return { schema: 2, meetings: [], tasks: [] };
}
export function newAgenda(title = "새 안건"): Agenda {
  return {
    id: crypto.randomUUID(),
    title,
    product: "",
    category: "development",
    partner: "",
    owner: "",
    previous: "",
    report: "",
    plan: "",
    decision: "",
    source: "",
    visuals: [],
  };
}
export function newMeeting(date = todayInSeoul()): Session {
  return {
    id: crypto.randomUUID(),
    title: "음향기술연구소 주간회의",
    date,
    department: "음향기술연구소",
    attendees: "",
    status: "draft",
    notes: "",
    transcript: "",
    reviewed: false,
    agenda: [],
    recordings: [],
  };
}
export function insertMeeting(board: Board, meeting: Session): Board {
  return {
    ...board,
    meetings: [meeting, ...board.meetings],
    tasks: board.tasks.map((t) =>
      t.status !== "done" &&
      t.meetingIds.some((id) =>
        board.meetings.some((old) => old.id === id && old.date < meeting.date),
      )
        ? { ...t, meetingIds: [...new Set([...t.meetingIds, meeting.id])] }
        : t,
    ),
  };
}
export function carryMeeting(board: Board, from: Session, date: string): Board {
  const meetingId = uuidV5(date, from.id);
  const existing = board.meetings.find(
    (m) => m.id === meetingId || (m.copiedFrom === from.id && m.date === date),
  );
  if (existing)
    return {
      ...board,
      meetings: [
        existing,
        ...board.meetings.filter((m) => m.id !== existing.id),
      ],
    };
  const m: Session = {
    ...newMeeting(date),
    id: meetingId,
    title: from.title,
    department: from.department,
    attendees: from.attendees,
    copiedFrom: from.id,
    agenda: from.agenda
      .filter((a) => !a.deletedAt)
      .map((a) => ({
        ...structuredClone(a),
        id: uuidV5(a.id, meetingId),
        previous: "",
        source: `${from.date} 회의에서 이어받음`,
        carriedFrom: { meetingId: from.id, agendaId: a.id, date: from.date },
        visuals: a.visuals.map((v) => ({
          ...structuredClone(v),
          id: uuidV5(v.id, uuidV5(a.id, meetingId)),
          carriedFrom: v.carriedFrom ?? { date: from.date, visualId: v.id },
        })),
      })),
  };
  return insertMeeting(board, m);
}
export function previousAgenda(
  board: Board,
  agenda: Agenda,
): Agenda | undefined {
  if (!agenda.carriedFrom) return;
  return board.meetings
    .find((m) => m.id === agenda.carriedFrom!.meetingId)
    ?.agenda.find((a) => a.id === agenda.carriedFrom!.agendaId);
}
export function agendaChangedFields(
  agenda: Agenda,
  previous: Agenda | undefined,
): string[] {
  if (!previous) return [];
  const keys = [
    "title",
    "product",
    "category",
    "report",
    "plan",
    "decision",
  ] as const;
  const fields: string[] = keys
    .filter((k) => agenda[k] !== previous[k])
    .map(
      (k) =>
        ({
          title: "제목",
          product: "제품",
          category: "분류",
          report: "진행 내용",
          plan: "다음 계획",
          decision: "회의 결정",
        })[k],
    );
  const visualInfo = (a: Agenda) =>
    a.visuals.map((v) => [
      v.carriedFrom?.visualId ?? v.id,
      v.label,
      v.status,
      v.comment,
      v.reviewer,
    ]);
  if (
    JSON.stringify(visualInfo(agenda)) !== JSON.stringify(visualInfo(previous))
  )
    fields.push("첨부·검토");
  return fields;
}
export function deleteAgenda(
  board: Board,
  meetingId: string,
  agendaId: string,
  at = new Date().toISOString(),
): Board {
  return {
    ...board,
    meetings: board.meetings.map((m) =>
      m.id === meetingId
        ? {
            ...m,
            status: "draft",
            reviewed: false,
            agenda: m.agenda.map((a) =>
              a.id === agendaId ? { ...a, deletedAt: at } : a,
            ),
          }
        : m,
    ),
  };
}
export function restoreAgenda(
  board: Board,
  meetingId: string,
  agendaId: string,
): Board {
  return {
    ...board,
    meetings: board.meetings.map((m) =>
      m.id === meetingId
        ? {
            ...m,
            status: "draft",
            reviewed: false,
            agenda: m.agenda.map((a) => {
              if (a.id !== agendaId) return a;
              const copy = { ...a };
              delete copy.deletedAt;
              return copy;
            }),
          }
        : m,
    ),
  };
}
export function addTask(
  board: Board,
  meetingId: string,
  input: Omit<WorkTask, "id" | "meetingIds">,
): Board {
  const title = input.title.trim();
  if (!title) throw new Error("업무 내용을 입력해 주세요.");
  const existing = board.tasks.find(
    (t) =>
      t.title.toLowerCase() === title.toLowerCase() &&
      t.product === input.product &&
      t.owner === input.owner &&
      t.status !== "done",
  );
  if (existing)
    return {
      ...board,
      tasks: board.tasks.map((t) =>
        t.id === existing.id
          ? { ...t, meetingIds: [...new Set([...t.meetingIds, meetingId])] }
          : t,
      ),
    };
  return {
    ...board,
    tasks: [
      ...board.tasks,
      { ...input, title, id: crypto.randomUUID(), meetingIds: [meetingId] },
    ],
  };
}
export function reviewVisual(
  v: Visual,
  status: ReviewStatus,
  comment: string,
  reviewer: string,
): Visual {
  if (status === "changes" && !comment.trim())
    throw new Error("수정 요청 내용을 입력해 주세요.");
  if (!reviewer.trim())
    throw new Error("의견을 남기는 분의 이름을 입력해 주세요.");
  const at = new Date().toISOString();
  return {
    ...v,
    carriedFrom: undefined,
    status,
    comment,
    reviewer,
    reviewedAt: at,
    history: [...v.history, { status, comment, reviewer, at }],
  };
}
export const fileMimes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "audio/webm",
  "video/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
];
