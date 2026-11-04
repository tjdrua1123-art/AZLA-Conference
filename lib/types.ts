export type Role = "admin" | "editor" | "viewer";
export type Profile = { id: string; name: string; role: Role; active: boolean };
export type Meeting = {
  id: string;
  meeting_date: string;
  title: string;
  agenda: string;
  product: string;
  notes: string;
  transcript: string;
  summary: string;
  discussion: string;
  decisions: string;
  status: "draft" | "final";
  ai_reviewed: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Task = {
  id: string;
  title: string;
  product: string;
  owner_id: string | null;
  due_date: string | null;
  status: "todo" | "doing" | "done";
  created_at: string;
};
export type Attachment = {
  id: string;
  meeting_id: string;
  path: string;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
};
export type Revision = {
  id: number;
  meeting_id: string;
  version: number;
  snapshot: Meeting;
  changed_by: string;
  created_at: string;
};
export const canWrite = (p: Profile | null) =>
  !!p?.active && p.role !== "viewer";
export function todayInSeoul(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
export function nextMonday(now = new Date()) {
  const d = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function filterMeetings(
  items: Meeting[],
  query: string,
  product: string,
  date: string,
) {
  const q = query.toLocaleLowerCase().trim();
  return items.filter(
    (m) =>
      (!product || m.product === product) &&
      (!date || m.meeting_date === date) &&
      (!q ||
        [
          m.title,
          m.product,
          m.agenda,
          m.notes,
          m.transcript,
          m.summary,
          m.discussion,
          m.decisions,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q)),
  );
}
