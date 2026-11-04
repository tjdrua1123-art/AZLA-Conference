"use client";
import { useState } from "react";
import { Plus, Save, Upload, X } from "lucide-react";
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
  onClose,
  onSave,
}: {
  initial: Agenda | null;
  category: Category;
  onClose: () => void;
  onSave: (agenda: Agenda, files: File[]) => Promise<void>;
}) {
  const [value, setValue] = useState<Agenda>(
    initial || { ...newAgenda(), category },
  );
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop">
      <section
        className="modal agenda-entry"
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "안건 수정" : "안건 등록"}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MEETING CONTENT</span>
            <h2>{initial ? "회의 내용 수정" : "회의 내용 입력"}</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="입력 창 닫기"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onSave(value, files);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              분류
              <select
                aria-label="안건 분류"
                value={value.category}
                onChange={(e) =>
                  setValue((v) => ({
                    ...v,
                    category: e.target.value as Category,
                  }))
                }
              >
                {!isCategory(value.category) && (
                  <option value={value.category}>
                    이전 분류 · 새 분류를 선택해 주세요.
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
                onChange={(e) =>
                  setValue((v) => ({ ...v, product: e.target.value }))
                }
              />
            </label>
          </div>
          <label>
            안건 제목
            <input
              required
              aria-label="안건 제목"
              maxLength={200}
              placeholder="회의에서 확인할 내용을 입력하세요."
              value={value.title}
              onChange={(e) =>
                setValue((v) => ({ ...v, title: e.target.value }))
              }
            />
          </label>
          <div className="form-grid">
            <label>
              진행 내용
              <textarea
                aria-label="진행 내용"
                rows={8}
                maxLength={60000}
                placeholder="이번 주 진행 상황과 검토 결과"
                value={value.report}
                onChange={(e) =>
                  setValue((v) => ({ ...v, report: e.target.value }))
                }
              />
            </label>
            <label>
              다음 계획
              <textarea
                aria-label="다음 계획"
                rows={8}
                maxLength={30000}
                placeholder="다음에 할 일과 확인할 사항"
                value={value.plan}
                onChange={(e) =>
                  setValue((v) => ({ ...v, plan: e.target.value }))
                }
              />
            </label>
          </div>
          <label>
            회의 결정
            <textarea
              aria-label="회의 결정"
              rows={3}
              maxLength={30000}
              placeholder="회의에서 결정한 내용을 기록하세요."
              value={value.decision}
              onChange={(e) =>
                setValue((v) => ({ ...v, decision: e.target.value }))
              }
            />
          </label>
          <div className="entry-upload">
            <label className="secondary file-button">
              <Upload size={15} /> 이미지 · PDF 추가
              <input
                type="file"
                aria-label="첨부파일 선택"
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp,application/pdf"
                disabled={busy}
                onChange={(e) => {
                  const incoming = Array.from(e.target.files || []);
                  setFiles((f) => [...f, ...incoming]);
                  e.target.value = "";
                }}
              />
            </label>
            <small>
              파일당 최대 20MB · 디자인 탭에서 검토할 자료는 분류를 ‘디자인’으로
              등록하세요.
            </small>
          </div>
          <ul className="entry-files">
            {value.visuals.map((v) => (
              <li key={v.id}>{v.name} · 기존 첨부</li>
            ))}
            {files.map((f, i) => (
              <li key={i}>
                {f.name}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${f.name} 첨부 취소`}
                  onClick={() => setFiles((x) => x.filter((_, n) => n !== i))}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-action-row">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              취소
            </button>
            <button
              className="primary"
              disabled={
                busy || !value.title.trim() || !isCategory(value.category)
              }
            >
              <Save size={15} />
              {busy ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
