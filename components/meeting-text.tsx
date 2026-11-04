"use client";
import { useEffect, useRef, useState } from "react";
import type { Agenda } from "@/lib/conference";
export function MeetingText({
  value,
  previous,
  expanded = false,
}: {
  value: string;
  previous?: string;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      if (!open && !expanded)
        setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, open, expanded]);
  const changed = previous !== undefined && value !== previous;
  const oldLines = new Set(
    (previous || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const lines = value.split("\n");
  const needsExpand = overflows || lines.length > 4 || value.length > 180;
  return (
    <div className={`readable-text ${open || expanded ? "expanded" : ""}`}>
      <div className="readable-lines" ref={body}>
        {value ? (
          lines.map((line, i) => (
            <p
              key={i}
              className={
                changed && line.trim() && !oldLines.has(line.trim())
                  ? "changed-line"
                  : ""
              }
            >
              {line || "\u00a0"}
            </p>
          ))
        ) : (
          <p className="muted">—</p>
        )}
      </div>
      {changed && <span className="text-change-tag">전주 대비 변경</span>}
      {needsExpand && !expanded && (
        <button
          className="text-button expand-text"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "접기" : "내용 펼치기"}
        </button>
      )}
    </div>
  );
}
export function AgendaComparison({
  agenda,
  previous,
}: {
  agenda: Agenda;
  previous: Agenda;
}) {
  const [field, setField] = useState<"report" | "plan" | "decision">("report");
  return (
    <div className="agenda-comparison">
      <div className="comparison-field-tabs">
        {(["report", "plan", "decision"] as const).map((k) => (
          <button
            key={k}
            className={field === k ? "active" : ""}
            onClick={() => setField(k)}
          >
            {
              { report: "진행 내용", plan: "다음 계획", decision: "회의 결정" }[
                k
              ]
            }
          </button>
        ))}
      </div>
      <div className="before-after">
        <section>
          <h3>{agenda.carriedFrom?.date} · 전주 내용</h3>
          <div className="comparison-source">
            {previous[field] || "기록 없음"}
          </div>
        </section>
        <section>
          <h3>이번 주 · 수정된 내용</h3>
          <MeetingText
            value={agenda[field]}
            previous={previous[field]}
            expanded
          />
        </section>
      </div>
    </div>
  );
}
