"use client";
import { Edit3, FileText, Trash2, ArrowUpRight } from "lucide-react";
import {
  agendaChangedFields,
  previousAgenda,
  type Agenda,
  type Board,
  type Visual,
} from "@/lib/conference";
import type { StorageMode } from "@/lib/conference-storage";
import { AssetImage, downloadAsset } from "./conference-assets";
import { MeetingText, LegacyPlan } from "./meeting-text";
export default function ProjectOverview({
  agendas,
  board,
  mode,
  expanded,
  onEdit,
  onDelete,
  onCompare,
  onReview,
  onError,
}: {
  agendas: Agenda[];
  board: Board;
  mode: StorageMode;
  expanded: boolean;
  onEdit: (agenda: Agenda) => void;
  onDelete: (agenda: Agenda) => void;
  onCompare: (id: string) => void;
  onReview: (agenda: Agenda, file: Visual) => void;
  onError: (error: string) => void;
}) {
  return (
    <div className="project-overview">
      <div className="project-list" aria-label="프로젝트 회의자료">
        {agendas.map((a, i) => {
          const previous = previousAgenda(board, a);
          const changed = agendaChangedFields(a, previous);
          const oldReportLines = new Set(
            (previous?.report || "").split("\n").map((line) => line.trim()),
          );
          const hasNewReportLines = a.report
            .split("\n")
            .some((line) => line.trim() && !oldReportLines.has(line.trim()));
          const images = a.visuals.filter((v) => v.mime.startsWith("image/"));
          const files = a.visuals.filter((v) => !v.mime.startsWith("image/"));
          const state = !a.carriedFrom
            ? "new"
            : changed.length
              ? "changed"
              : "unchanged";
          return (
            <article
              className={`project-card ${state}`}
              id={`project-${a.id}`}
              key={a.id}
              tabIndex={-1}
              aria-label={`${a.product || a.title} 프로젝트`}
            >
              <header className="project-card-heading">
                <span className="project-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="project-identity">
                  <h3>{a.product || a.title}</h3>
                  {a.product && a.product !== a.title && <p>{a.title}</p>}
                </div>
                <span className={`project-state ${state}`}>
                  {state === "new"
                    ? "신규 안건"
                    : state === "changed"
                      ? `변경 ${changed.length}곳`
                      : "이전 내용 유지"}
                </span>
                {previous && (
                  <button
                    className="text-button project-compare"
                    onClick={() => onCompare(a.id)}
                    aria-label={`${a.title} 이전 회의와 비교`}
                  >
                    이전 회의 비교 <ArrowUpRight size={13} />
                  </button>
                )}
                <button
                  className="secondary project-edit"
                  aria-label={`${a.title} 수정`}
                  onClick={() => onEdit(a)}
                >
                  <Edit3 size={14} />
                  수정
                </button>
                <button
                  className="icon-button delete-entry-button"
                  aria-label={`${a.title} 삭제`}
                  onClick={() => onDelete(a)}
                >
                  <Trash2 size={15} />
                </button>
              </header>
              <div
                className={`project-card-body ${images.length ? "with-images" : ""}`}
              >
                <section
                  className="project-progress"
                  aria-label={`${a.title} 진행 내용`}
                >
                  <h4>
                    진행 내용{" "}
                    {previous && a.report !== previous.report && (
                      <small>
                        {hasNewReportLines
                          ? "바뀐 문장 먼저"
                          : "이전 회의 대비 변경"}
                      </small>
                    )}
                  </h4>
                  <MeetingText
                    value={a.report}
                    previous={previous?.report}
                    expanded={expanded}
                    prioritizeChanges
                  />
                  {a.plan && <LegacyPlan value={a.plan} />}
                  {files.length > 0 && (
                    <div className="project-files">
                      {files.map((v) => (
                        <button
                          key={v.id}
                          className="text-button"
                          onClick={() =>
                            void downloadAsset(mode, v).catch((e) =>
                              onError(e.message),
                            )
                          }
                        >
                          <FileText size={15} />
                          {v.name}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <section
                  className={`project-decision ${a.decision.trim() ? "recorded" : ""}`}
                  aria-label={`${a.title} 회의 결정`}
                >
                  <h4>회의 결정</h4>
                  {a.decision.trim() ? (
                    <MeetingText
                      value={a.decision}
                      previous={previous?.decision}
                      expanded={expanded}
                    />
                  ) : (
                    <p className="decision-placeholder">
                      회의에서 결정한 내용을
                      <br />
                      기록해 주세요.
                    </p>
                  )}
                </section>
                {images.length > 0 && (
                  <section
                    className="project-media"
                    aria-label={`${a.title} 참고 이미지`}
                  >
                    <h4>
                      참고 이미지 <small>{images.length}장 · 눌러서 확대</small>
                    </h4>
                    <div className="project-image-strip">
                      {images.map((v) => (
                        <AssetImage
                          key={v.id}
                          mode={mode}
                          file={v}
                          onClick={() => onReview(a, v)}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectNavigator({ agendas }: { agendas: Agenda[] }) {
  return (
    <nav className="project-navigator" aria-label="프로젝트 바로가기">
      <span>프로젝트</span>
      <div>
        {agendas.map((a, i) => (
          <button
            key={a.id}
            onClick={() => {
              const node = document.getElementById(`project-${a.id}`);
              const behavior = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches
                ? "auto"
                : "smooth";
              const list = node?.closest<HTMLElement>(".project-list");
              if (node && list && getComputedStyle(list).overflowY === "auto") {
                list.scrollTo({
                  top:
                    list.scrollTop +
                    node.getBoundingClientRect().top -
                    list.getBoundingClientRect().top -
                    2,
                  behavior,
                });
              } else {
                node?.scrollIntoView({ block: "start", behavior });
              }
              node?.focus({ preventScroll: true });
            }}
          >
            <b>{String(i + 1).padStart(2, "0")}</b>
            {a.product || a.title}
          </button>
        ))}
      </div>
    </nav>
  );
}
