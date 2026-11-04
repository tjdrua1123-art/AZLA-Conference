import { z } from "zod";
import { nextMonday } from "./types";
export const reviewLabels = {
  pending: "검토 대기",
  approved: "승인",
  changes: "수정 요청",
} as const;
export type ReviewStatus = keyof typeof reviewLabels;
export const categoryLabels = {
  development: "신제품 개발",
  production: "양산 / 납품",
  partner: "협력업체",
  pending: "보류 프로젝트",
  other: "기타",
} as const;
const uid = z.uuid();
const short = z.string().max(500);
export const visualSchema = z.object({
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
  id: uid,
  title: short,
  product: short,
  category: z.enum([
    "development",
    "production",
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
export const sessionSchema = z.object({
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
export function newMeeting(date = nextMonday()): Session {
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
  const m: Session = {
    ...newMeeting(date),
    department: from.department,
    attendees: from.attendees,
    agenda: from.agenda.map((a) => ({
      ...newAgenda(a.title),
      product: a.product,
      category: a.category,
      owner: a.owner,
      partner: a.partner,
      previous: a.report,
      source: `${from.date} 회의에서 이월`,
    })),
  };
  return {
    ...board,
    meetings: [m, ...board.meetings],
    tasks: board.tasks.map((t) =>
      t.status !== "done" &&
      t.meetingIds.some((id) =>
        board.meetings.some((old) => old.id === id && old.date < date),
      )
        ? { ...t, meetingIds: [...new Set([...t.meetingIds, m.id])] }
        : t,
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
