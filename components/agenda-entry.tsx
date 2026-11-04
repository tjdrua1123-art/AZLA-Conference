"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Columns2,
  Save,
  Upload,
  X,
} from "lucide-react";
import {
  categoryLabels,
  isCategory,
  newAgenda,
  type Agenda,
  type Category,
} from "@/lib/conference";
export default function AgendaEntry({
  initial,
  category,
  previous,
  onClose,
  onSave,
  onSaved,
  onStep,
  position,
}: {
  initial: Agenda | null;
  category: Category;
  previous?: Agenda;
  onClose: () => void;
  onSave: (agenda: Agenda, files: File[]) => Promise<Agenda>;
  onSaved?: (agenda: Agenda) => void;
  onStep?: (by: number) => void;
  position?: { index: number; total: number };
}) {
  const [value, setValue] = useState<Agenda>(
    initial || { ...newAgenda(), category },
  );
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [focus, setFocus] = useState<"report" | "plan" | "decision" | null>(
    null,
  );
  const [compare, setCompare] = useState(false);
  const [compareField, setCompareField] = useState<
    "report" | "plan" | "decision"
  >("report");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width:800px)").matches) setFocus("report");
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        form.current?.requestSubmit();
      }
      if (e.key === "Tab") {
        const dialog = form.current?.closest("section");
        const nodes = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])",
          ) || [],
        ).filter((n) => n.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  function set<K extends keyof Agenda>(key: K, next: Agenda[K]) {
    setValue((v) => ({ ...v, [key]: next }));
    setChanged(true);
    setFeedback("");
  }
  function close() {
    if (
      (!changed && !files.length) ||
      window.confirm("아직 저장하지 않은 수정이 있습니다. 닫을까요?")
    )
      onClose();
  }
  async function save(exit = false) {
    if (busy || !value.title.trim() || !isCategory(value.category)) return;
    setBusy(true);
    setError("");
    try {
      const saved = await onSave(value, files);
      setValue(saved);
      setFiles([]);
      setChanged(false);
      setFeedback("저장했습니다.");
      onSaved?.(saved);
      if (exit) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  function step(by: number) {
    if (
      (changed || files.length) &&
      !window.confirm("저장하지 않은 변경을 두고 다른 안건으로 이동할까요?")
    )
      return;
    onStep?.(by);
  }
  return (
    <div className="modal-backdrop entry-backdrop">
      <section
        className="modal agenda-entry entry-fullscreen"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "안건 수정" : "안건 등록"}
      >
        <header className="entry-topbar">
          <div>
            <span className="eyebrow">
              {initial ? "EDIT MEETING CONTENT" : "NEW MEETING CONTENT"}
            </span>
            <h2>
              {initial ? "회의 내용 수정" : "회의 내용 입력"}
              {value.carriedFrom && (
                <small>{value.carriedFrom.date} 내용 이어받음</small>
              )}
            </h2>
          </div>
          <div className="entry-top-actions">
            {position && (
              <span>
                {position.index + 1} / {position.total}
              </span>
            )}
            {onStep && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="이전 안건"
                  disabled={busy || position?.index === 0}
                  onClick={() => step(-1)}
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="다음 안건"
                  disabled={
                    busy || !position || position.index >= position.total - 1
                  }
                  onClick={() => step(1)}
                >
                  <ArrowRight size={18} />
                </button>
              </>
            )}
            {previous && (
              <button
                type="button"
                className={`secondary ${compare ? "selected" : ""}`}
                onClick={() => {
                  setCompare((v) => !v);
                  setFocus(null);
                }}
              >
                <Columns2 size={15} />
                {compare ? "입력 화면" : "전주와 비교"}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label="입력 창 닫기"
              onClick={close}
            >
              <X />
            </button>
          </div>
        </header>
        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="entry-fields" disabled={busy}>
            <div className="entry-metadata">
              <label>
                분류
                <select
                  aria-label="안건 분류"
                  value={value.category}
                  onChange={(e) => set("category", e.target.value as Category)}
                >
                  {!isCategory(value.category) && (
                    <option value={value.category}>
                      분류를 선택해 주세요.
                    </option>
                  )}
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                제품명
                <input
                  value={value.product}
                  maxLength={500}
                  onChange={(e) => set("product", e.target.value)}
                />
              </label>
              <label>
                안건 제목
                <input
                  required
                  aria-label="안건 제목"
                  value={value.title}
                  maxLength={200}
                  onChange={(e) => set("title", e.target.value)}
                />
              </label>
            </div>
            {!compare && (
              <div className="mobile-entry-fields">
                {(["report", "plan", "decision"] as const).map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={focus === k ? "active" : ""}
                    onClick={() => setFocus(k)}
                  >
                    {
                      {
                        report: "진행 내용",
                        plan: "다음 계획",
                        decision: "회의 결정",
                      }[k]
                    }
                  </button>
                ))}
              </div>
            )}
            {compare && previous ? (
              <div className="entry-compare-mode">
                <div className="comparison-field-tabs">
                  {(["report", "plan", "decision"] as const).map((k) => (
                    <button
                      type="button"
                      key={k}
                      className={compareField === k ? "active" : ""}
                      onClick={() => setCompareField(k)}
                    >
                      {
                        {
                          report: "진행 내용",
                          plan: "다음 계획",
                          decision: "회의 결정",
                        }[k]
                      }
                    </button>
                  ))}
                </div>
                <div className="entry-comparison-panes">
                  <label>
                    전주 내용 · 읽기 전용
                    <textarea
                      aria-label="전주 내용"
                      readOnly
                      value={previous[compareField]}
                    />
                  </label>
                  <label>
                    이번 주 · 수정 가능
                    <textarea
                      aria-label="이번 주 비교 수정"
                      maxLength={compareField === "report" ? 60000 : 30000}
                      value={value[compareField]}
                      onChange={(e) => set(compareField, e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className={`entry-writing-panels ${focus ? "focused" : ""}`}>
                {(["report", "plan", "decision"] as const)
                  .filter((k) => !focus || focus === k)
                  .map((key, i) => (
                    <section className="entry-writing-panel" key={key}>
                      <div>
                        <h3>
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {
                            {
                              report: "진행 내용",
                              plan: "다음 계획",
                              decision: "회의 결정",
                            }[key]
                          }
                        </h3>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            setFocus((f) => (f === key ? null : key))
                          }
                        >
                          {focus ? "세 칸 모두 보기" : "넓게 쓰기"}
                        </button>
                      </div>
                      <textarea
                        aria-label={
                          {
                            report: "진행 내용",
                            plan: "다음 계획",
                            decision: "회의 결정",
                          }[key]
                        }
                        maxLength={key === "report" ? 60000 : 30000}
                        placeholder={
                          {
                            report:
                              "기존 진행 내용에서 바뀐 부분만 수정하세요.",
                            plan: "다음에 할 일과 확인할 사항을 작성하세요.",
                            decision: "회의에서 결정된 내용을 기록하세요.",
                          }[key]
                        }
                        value={value[key]}
                        onChange={(e) => set(key, e.target.value)}
                      />
                    </section>
                  ))}
              </div>
            )}
            <div className="entry-attachment-bar">
              <label className="secondary file-button">
                <Upload size={15} />
                이미지 · PDF 추가
                <input
                  hidden
                  type="file"
                  aria-label="첨부파일 선택"
                  multiple
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  disabled={busy}
                  onChange={(e) => {
                    const incoming = Array.from(e.target.files || []);
                    setFiles((v) => [...v, ...incoming]);
                    setChanged(true);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="entry-attachment-list">
                {value.visuals.map((v) => (
                  <span key={v.id}>
                    {v.name}
                    <small>보관 중</small>
                  </span>
                ))}
                {files.map((f, i) => (
                  <span key={i}>
                    {f.name}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${f.name} 첨부 취소`}
                      onClick={() =>
                        setFiles((items) => items.filter((_, n) => i !== n))
                      }
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
                {!value.visuals.length && !files.length && (
                  <small>파일당 최대 20MB · 필요한 자료를 첨부하세요.</small>
                )}
              </div>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </fieldset>
          <footer className="entry-fixed-footer">
            <div>
              {feedback ? (
                <span className="entry-saved" role="status">
                  <Check size={14} />
                  {feedback}
                </span>
              ) : (
                <span>
                  {changed || files.length
                    ? "저장하지 않은 변경이 있습니다."
                    : "기존 내용을 유지하며 필요한 부분만 수정하세요."}
                </span>
              )}
              <small>Ctrl / Cmd + S로 저장</small>
            </div>
            <div>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={close}
              >
                닫기
              </button>
              <button
                type="submit"
                className="secondary"
                disabled={
                  busy || !value.title.trim() || !isCategory(value.category)
                }
              >
                <Save size={15} />
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  busy || !value.title.trim() || !isCategory(value.category)
                }
                onClick={() => void save(true)}
              >
                저장 후 닫기
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
