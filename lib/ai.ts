import { z } from "zod";
const item = z
  .object({ text: z.string().max(3000), evidence: z.string().min(2).max(3000) })
  .strict();
export const aiSchema = z
  .object({
    summary: z.array(item).max(20),
    discussion: z.array(item).max(30),
    decisions: z.array(item).max(30),
    tasks: z
      .array(
        z
          .object({
            title: z.string().max(500),
            owner: z.string().nullable(),
            due_date: z.string().nullable(),
            evidence: z.string().min(2).max(3000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type AIDraft = z.infer<typeof aiSchema>;
export function validateEvidence(value: unknown, source: string): AIDraft {
  const parsed = aiSchema.parse(value);
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const text = normalize(source);
  for (const i of [
    ...parsed.summary,
    ...parsed.discussion,
    ...parsed.decisions,
    ...parsed.tasks,
  ])
    if (!text.includes(normalize(i.evidence)))
      throw new Error(
        "AI가 원문에서 확인되지 않는 근거를 반환했습니다. 다시 시도하거나 직접 작성해 주세요.",
      );
  for (const t of parsed.tasks) {
    if (t.owner && !normalize(t.evidence).includes(normalize(t.owner)))
      t.owner = null;
    if (
      t.due_date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ||
        !t.evidence.includes(t.due_date))
    )
      t.due_date = null;
  }
  return parsed;
}
export const outputSchema = {
  type: "object",
  properties: {
    summary: { type: "array", items: { $ref: "#/$defs/item" } },
    discussion: { type: "array", items: { $ref: "#/$defs/item" } },
    decisions: { type: "array", items: { $ref: "#/$defs/item" } },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          owner: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          evidence: { type: "string" },
        },
        required: ["title", "owner", "due_date", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "discussion", "decisions", "tasks"],
  additionalProperties: false,
  $defs: {
    item: {
      type: "object",
      properties: { text: { type: "string" }, evidence: { type: "string" } },
      required: ["text", "evidence"],
      additionalProperties: false,
    },
  },
};
