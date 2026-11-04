"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Maximize2,
  MessageSquare,
  X,
} from "lucide-react";
import {
  type Agenda,
  type ReviewStatus,
  type Visual,
  reviewLabels,
  reviewVisual,
} from "@/lib/conference";
import { fileBlob, type StorageMode } from "@/lib/conference-storage";
export function useAsset(mode: StorageMode, file: Visual) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let created = "";
    void fileBlob(mode, file)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (active) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => {
        if (active) setError("파일을 불러오지 못했습니다.");
      });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mode, file.path]);
  return { url, error };
}
export function AssetImage({
  mode,
  file,
  onClick,
}: {
  mode: StorageMode;
  file: Visual;
  onClick?: () => void;
}) {
  const { url, error } = useAsset(mode, file);
  return (
    <button
      className="visual-image"
      onClick={onClick}
      aria-label={`${file.label || file.name} 확대`}
    >
      {url ? (
        <img src={url} alt={file.label || file.name} />
      ) : (
        <span>{error || "이미지 불러오는 중…"}</span>
      )}
    </button>
  );
}
export async function downloadAsset(mode: StorageMode, file: Visual) {
  const blob = await fileBlob(mode, file);
  downloadBlob(blob, file.name);
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function ReviewDialog({
  mode,
  file,
  onClose,
  onReview,
}: {
  mode: StorageMode;
  file: Visual;
  onClose: () => void;
  onReview: (visual: Visual) => void;
}) {
  const [status, setStatus] = useState<ReviewStatus>(file.status);
  const [comment, setComment] = useState(file.comment);
  const [reviewer, setReviewer] = useState(file.reviewer);
  const [error, setError] = useState("");
  return (
    <div
      className="review-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="시안 검토"
    >
      <div className="review-dialog">
        <div className="review-image">
          <AssetImage mode={mode} file={file} />
          <button
            className="secondary download-original"
            onClick={() =>
              void downloadAsset(mode, file).catch((e) => setError(e.message))
            }
          >
            <Download size={15} /> 원본 다운로드
          </button>
        </div>
        <aside>
          <div className="section-heading">
            <div>
              <span className="eyebrow">DESIGN REVIEW</span>
              <h2>{file.label || file.name}</h2>
            </div>
            <button
              className="icon-button"
              aria-label="검토 닫기"
              onClick={onClose}
            >
              <X />
            </button>
          </div>
          <p className="muted">
            시안을 확인하고 대표님 의견과 검토 결과를 기록하세요.
          </p>
          <label>
            검토 결과
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ReviewStatus)}
            >
              {Object.entries(reviewLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            검토자 이름
            <input
              placeholder="예: 대표님 / 의견 기록자"
              value={reviewer}
              maxLength={100}
              onChange={(e) => setReviewer(e.target.value)}
            />
          </label>
          <label>
            컨펌 의견
            <textarea
              rows={6}
              placeholder="수정할 위치, 색상, 로고, 형상 등을 구체적으로 기록하세요."
              value={comment}
              maxLength={10000}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary full"
            onClick={() => {
              try {
                onReview(reviewVisual(file, status, comment, reviewer));
                onClose();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "검토 내용을 확인해 주세요.",
                );
              }
            }}
          >
            <Check size={16} /> 검토 결과 반영
          </button>
          <p className="muted helper">
            반영한 뒤 상단 ‘회의 저장’을 눌러 보관하세요. 이름은 직접 기입하는
            기록이며 전자서명이 아닙니다.
          </p>
          {file.history.length > 0 && (
            <div className="review-history">
              <h3>이전 검토 기록</h3>
              {[...file.history].reverse().map((h, i) => (
                <div key={i}>
                  <span className={`review-badge ${h.status}`}>
                    {reviewLabels[h.status]}
                  </span>
                  <strong>{h.reviewer}</strong>
                  <small>
                    {new Date(h.at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </small>
                  <p>{h.comment || "별도 의견 없음"}</p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
export function CompareDialog({
  mode,
  files,
  onClose,
}: {
  mode: StorageMode;
  files: Visual[];
  onClose: () => void;
}) {
  return (
    <div
      className="comparison-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="시안 나란히 비교"
    >
      <header>
        <div>
          <span className="eyebrow">SIDE BY SIDE</span>
          <h2>시안을 나란히 비교합니다.</h2>
        </div>
        <button className="secondary" onClick={onClose}>
          <X size={17} /> 비교 닫기
        </button>
      </header>
      <div className="comparison-grid">
        {files.map((v) => (
          <section key={v.id}>
            <h3>
              {v.label || v.name}
              <span className={`review-badge ${v.status}`}>
                {reviewLabels[v.status]}
              </span>
            </h3>
            <AssetImage mode={mode} file={v} />
            <p>{v.comment || "아직 기록된 의견이 없습니다."}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
export function Presentation({
  mode,
  agenda,
  onClose,
  onReview,
}: {
  mode: StorageMode;
  agenda: Agenda[];
  onClose: () => void;
  onReview: (agenda: Agenda, file: Visual) => void;
}) {
  const frames = agenda.flatMap((a) => [
    { agenda: a, file: null as Visual | null },
    ...a.visuals
      .filter((v) => v.mime.startsWith("image/"))
      .map((v) => ({ agenda: a, file: v })),
  ]);
  const [index, setIndex] = useState(0);
  const current = frames[Math.min(index, frames.length - 1)];
  const move = (by: number) =>
    setIndex((i) => Math.max(0, Math.min(frames.length - 1, i + by)));
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [frames.length, onClose]);
  if (!current) return null;
  return (
    <div
      className="presentation"
      role="dialog"
      aria-modal="true"
      aria-label="회의 진행 모드"
    >
      <header>
        <div>
          <span className="eyebrow">AZLA · MEETING ROOM</span>
          <h2>{current.agenda.product || current.agenda.title}</h2>
        </div>
        <div>
          <span>
            {index + 1} / {frames.length}
          </span>
          <button className="secondary" onClick={onClose}>
            <X size={17} /> 회의 모드 종료
          </button>
        </div>
      </header>
      <main>
        {current.file ? (
          <>
            <h3 className="presentation-label">
              {current.file.label}
              <span className={`review-badge ${current.file.status}`}>
                {reviewLabels[current.file.status]}
              </span>
            </h3>
            <AssetImage mode={mode} file={current.file} />
            <div className="presentation-feedback">
              <p>
                {current.file.comment ||
                  "검토 의견을 함께 확인하고 기록하세요."}
              </p>
              <button
                className="primary"
                onClick={() => onReview(current.agenda, current.file!)}
              >
                <MessageSquare size={17} /> 컨펌 의견 기록
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>{current.agenda.title}</h1>
            <div className="presentation-columns">
              <section>
                <h3>이번 주 업무 보고</h3>
                <p>
                  {current.agenda.report || "이번 주 진행 상황을 입력하세요."}
                </p>
              </section>
              <section>
                <h3>다음 계획</h3>
                <p>{current.agenda.plan || "후속 계획을 입력하세요."}</p>
                <h3>결정 · 확인할 사항</h3>
                <p>
                  {current.agenda.decision || "회의 중 결정을 기록해 주세요."}
                </p>
              </section>
            </div>
          </>
        )}
      </main>
      <footer>
        <button
          className="secondary"
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <ArrowLeft size={18} /> 이전
        </button>
        <span>← → 키로 이동 · Esc로 종료</span>
        <button
          className="secondary"
          disabled={index === frames.length - 1}
          onClick={() => move(1)}
        >
          다음 <ArrowRight size={18} />
        </button>
      </footer>
    </div>
  );
}
