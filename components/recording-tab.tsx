"use client";
import { useEffect, useState } from "react";
import JSZip from "jszip";
import {
  Check,
  Download,
  FileAudio,
  Mic,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { type AIDraft } from "@/lib/ai";
import { type Recording, type Session, type Visual } from "@/lib/conference";
import { fileBlob, type StorageMode } from "@/lib/conference-storage";
import { downloadBlob } from "./conference-assets";
const statusLabels = {
  recording: "녹음 중 또는 종료 확인 필요",
  processing: "음성 전사 · 요약 중",
  ready: "요약 저장 완료",
  needs_setup: "원본 저장 완료 · AI 연결 필요",
  failed: "원본 확인 · 다시 정리 필요",
};
function AudioPlayer({ mode, part }: { mode: StorageMode; part: Visual }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let created = "";
    void fileBlob(mode, part)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (active) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => setError("원본 구간을 불러오지 못했습니다."));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mode, part.path]);
  return url ? (
    <audio controls preload="metadata" src={url} aria-label="회의 녹음 재생" />
  ) : (
    <p className="muted">{error || "녹음 불러오는 중…"}</p>
  );
}
export default function RecordingTab({
  meeting,
  mode,
  processing,
  onRetry,
  onRecover,
  onUpload,
  onChange,
  onSave,
  onTask,
}: {
  meeting: Session;
  mode: StorageMode;
  processing: boolean;
  onRetry: (r: Recording) => void;
  onRecover: (r: Recording) => void;
  onUpload: (files: File[]) => void;
  onChange: (id: string, patch: Partial<Recording>) => void;
  onSave: () => void;
  onTask: (task: AIDraft["tasks"][number]) => void;
}) {
  const [selected, setSelected] = useState("");
  const [partId, setPartId] = useState("");
  const [error, setError] = useState("");
  const r =
    meeting.recordings.find((r) => r.id === selected) ||
    meeting.recordings.at(-1);
  const part = r?.parts.find((p) => p.id === partId) || r?.parts[0];
  async function download() {
    if (!r) return;
    try {
      const zip = new JSZip();
      for (const [i, p] of r.parts.entries())
        zip.file(
          `${String(i + 1).padStart(3, "0")}-${p.name}`,
          await (await fileBlob(mode, p)).arrayBuffer(),
        );
      zip.file("전사.txt", r.transcript);
      zip.file("요약.json", JSON.stringify(r.draft, null, 2));
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        `회의녹음-${meeting.date}.zip`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "다운로드에 실패했습니다.");
    }
  }
  function editDraft(
    key: "summary" | "discussion" | "decisions",
    index: number,
    text: string,
  ) {
    if (!r?.draft) return;
    onChange(r.id, {
      draft: {
        ...r.draft,
        [key]: r.draft[key].map((item, i) =>
          i === index ? { ...item, text } : item,
        ),
      },
      reviewed: false,
    });
  }
  return (
    <section className="recording-tab">
      <div className="recording-heading">
        <div>
          <h2>회의 녹음 내용</h2>
          <p>회의 종료 후 원본 녹음과 취합된 요약이 자동으로 저장됩니다.</p>
        </div>
        <label className="secondary file-button">
          <Upload size={15} /> 기존 녹음 추가
          <input
            type="file"
            hidden
            multiple
            accept="audio/*,video/webm"
            disabled={processing}
            onChange={(e) => {
              onUpload(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {!r ? (
        <div className="empty panel">
          <Mic size={32} />
          <h3>아직 회의 녹음이 없습니다.</h3>
          <p>
            상단 ‘회의 시작’을 누르면 녹음이 시작됩니다. 탭을 바꾸어도 계속
            녹음됩니다.
          </p>
        </div>
      ) : (
        <>
          {meeting.recordings.length > 1 && (
            <label className="recording-select">
              녹음 기록
              <select
                aria-label="녹음 기록 선택"
                value={r.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPartId("");
                }}
              >
                {meeting.recordings.map((r, i) => (
                  <option value={r.id} key={r.id}>
                    {i + 1}차 녹음 ·{" "}
                    {new Date(r.startedAt).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="recording-player panel">
            <FileAudio size={25} />
            <div className="recording-player-title">
              <strong>{meeting.title}</strong>
              <small>
                {meeting.date} · {Math.floor(r.durationSeconds / 60)}분{" "}
                {r.durationSeconds % 60}초 · {r.parts.length}개 구간
              </small>
            </div>
            <div className="player-control">
              {r.parts.length > 1 && (
                <select
                  aria-label="녹음 구간 선택"
                  value={part?.id || ""}
                  onChange={(e) => setPartId(e.target.value)}
                >
                  {r.parts.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      {i + 1}구간 · {p.name}
                    </option>
                  ))}
                </select>
              )}
              {part && <AudioPlayer mode={mode} part={part} />}
            </div>
            <button
              className="secondary"
              disabled={!r.parts.length}
              onClick={() => void download()}
            >
              <Download size={15} /> 원본 다운로드
            </button>
          </div>
          <div className={`recording-process ${r.status}`} role="status">
            <span>
              {statusLabels[r.status]}
              {r.reviewed ? " · 검토 확인됨" : ""}
            </span>
            <div>
              {["failed", "recording"].includes(r.status) && !processing && (
                <button className="secondary" onClick={() => onRecover(r)}>
                  녹음 복구 확인
                </button>
              )}
              <button
                className="secondary"
                disabled={processing || !r.parts.length}
                onClick={() => onRetry(r)}
              >
                <RefreshCw size={14} /> 다시 정리
              </button>
              <button
                className="primary"
                disabled={processing}
                onClick={() => {
                  onChange(r.id, { reviewed: true });
                  onSave();
                }}
              >
                <Save size={14} /> 검토 후 저장
              </button>
            </div>
          </div>
          {r.error && (
            <p className="notice" role="alert">
              {r.error}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {r.draft ? (
            <>
              <div className="draft-notice">
                AI가 정리한 초안입니다. 제품명·수치·담당자·일정을 확인해 주세요.
                직접 작성한 안건 내용은 변경되지 않습니다.
              </div>
              <div className="recording-results">
                <div>
                  {(["summary", "discussion", "decisions"] as const).map(
                    (key) => (
                      <section className="panel summary-section" key={key}>
                        <h3>
                          {
                            {
                              summary: "회의 핵심 요약",
                              discussion: "주요 논의 내용",
                              decisions: "결정 사항",
                            }[key]
                          }
                        </h3>
                        {r.draft![key].length ? (
                          r.draft![key].map((item, i) => (
                            <div className="summary-item" key={i}>
                              <textarea
                                aria-label={`${key === "summary" ? "핵심 요약" : key === "discussion" ? "논의 내용" : "결정 사항"} ${i + 1}`}
                                rows={2}
                                disabled={processing}
                                value={item.text}
                                onChange={(e) =>
                                  editDraft(key, i, e.target.value)
                                }
                              />
                              <details>
                                <summary>원문 근거</summary>
                                <blockquote>{item.evidence}</blockquote>
                              </details>
                            </div>
                          ))
                        ) : (
                          <p className="muted">
                            원문에 명확히 나온 내용이 없습니다.
                          </p>
                        )}
                      </section>
                    ),
                  )}
                </div>
                <section className="panel summary-section">
                  <h3>후속 업무</h3>
                  {r.draft.tasks.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>할 일</th>
                          <th>담당자</th>
                          <th>기한</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.draft.tasks.map((t, i) => (
                          <tr key={i}>
                            <td>
                              {t.title}
                              <button
                                className="text-button"
                                onClick={() => onTask(t)}
                              >
                                확인 후 업무 등록
                              </button>
                            </td>
                            <td>{t.owner || "미정"}</td>
                            <td>{t.due_date || "미정"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted">원문에 명시된 후속 업무가 없습니다.</p>
                  )}
                  <p className="helper muted">
                    담당자와 기한이 불명확하면 미정으로 남깁니다.
                  </p>
                </section>
              </div>
            </>
          ) : (
            <div className="panel empty">
              <h3>
                {r.status === "processing"
                  ? "전사와 요약 결과를 차례로 저장하고 있습니다."
                  : "요약 결과가 여기에 보관됩니다."}
              </h3>
              <p>
                원본이 저장된 후 AI 정리를 수행합니다. 연결 문제를 해결한 뒤
                다시 정리할 수 있습니다.
              </p>
            </div>
          )}
          <details className="transcript-section panel">
            <summary>음성 전사 원문 보기 · 직접 수정 가능</summary>
            <textarea
              aria-label="음성 전사 원문"
              rows={12}
              disabled={processing}
              value={r.transcript}
              maxLength={600000}
              onChange={(e) =>
                onChange(r.id, { transcript: e.target.value, reviewed: false })
              }
            />
          </details>
        </>
      )}
    </section>
  );
}
