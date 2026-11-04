"use client";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Sparkles, Square, Upload, X } from "lucide-react";
import { type Agenda, type Session, type Visual } from "@/lib/conference";
import { type AIDraft } from "@/lib/ai";
import { type StorageMode } from "@/lib/conference-storage";
import { downloadBlob } from "./conference-assets";
export default function ConferenceAI({
  meeting,
  agenda,
  mode,
  enabled,
  onChange,
  onFiles,
  onApply,
  onTask,
  onClose,
}: {
  meeting: Session;
  agenda: Agenda;
  mode: StorageMode;
  enabled: boolean;
  onChange: (patch: Partial<Session>) => void;
  onFiles: (files: File[]) => Promise<void>;
  onApply: (draft: AIDraft) => void;
  onTask: (task: AIDraft["tasks"][number]) => void;
  onClose: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<AIDraft | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (media.current?.state === "recording") media.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  const audio = agenda.visuals.filter(
    (v) => v.mime.startsWith("audio/") || v.mime === "video/webm",
  );
  async function ask(kind: "summary" | "transcribe", file?: Visual) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          meeting_id: meeting.id,
          notes: [meeting.notes, agenda.report, agenda.plan]
            .filter(Boolean)
            .join("\n"),
          transcript: meeting.transcript,
          attachment_id: file?.id,
          consent,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (kind === "transcribe")
        onChange({
          transcript: [meeting.transcript, b.text].filter(Boolean).join("\n\n"),
        });
      else setDraft(b.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (!consent) {
      setError("참석자의 녹음 동의 확인란을 먼저 선택해 주세요.");
      return;
    }
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "HTTPS 환경에서 마이크를 사용하거나 기존 녹음을 첨부해 주세요.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((s) =>
        MediaRecorder.isTypeSupported(s),
      );
      if (!mime) throw new Error("지원되는 녹음 형식이 없습니다.");
      const m = new MediaRecorder(stream.current, { mimeType: mime });
      media.current = m;
      const chunks: Blob[] = [];
      let size = 0;
      m.ondataavailable = (e) => {
        chunks.push(e.data);
        size += e.data.size;
        if (size > 19 * 1024 * 1024 && m.state === "recording") m.stop();
      };
      m.onerror = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setError("녹음 중 오류가 발생했습니다.");
      };
      m.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        const file = new File(
          chunks,
          `회의녹음-${Date.now()}.${mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm"}`,
          { type: mime },
        );
        if (!mounted.current) {
          downloadBlob(file, file.name);
          return;
        }
        setRecording(false);
        setBusy(true);
        try {
          await onFiles([file]);
        } catch (e) {
          downloadBlob(file, file.name);
          setError("업로드에 실패해 녹음 복구 파일을 다운로드했습니다.");
        } finally {
          setBusy(false);
        }
      };
      setSeconds(0);
      m.start(1000);
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(e instanceof Error ? e.message : "마이크 권한을 확인해 주세요.");
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal conference-ai"
        role="dialog"
        aria-modal="true"
        aria-label="녹음과 AI 초안"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MEETING ASSISTANT</span>
            <h2>회의를 기록하고, 초안으로 정리하세요.</h2>
          </div>
          <button
            className="icon-button"
            aria-label="AI 창 닫기"
            disabled={recording || busy}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="ai-layout">
          <div>
            {!enabled && (
              <div className="notice">
                녹음과 메모는 바로 저장할 수 있습니다. AI 전사와 정리는 팀 공유
                저장소 및 OpenAI 연결 후 사용할 수 있습니다.
              </div>
            )}
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                참석자에게 녹음 동의를 받았으며, AI 사용 시 자료가 OpenAI로
                전송됨을 확인했습니다.
              </span>
            </label>
            <div className="record-toolbar">
              <button
                className={recording ? "danger" : "secondary"}
                disabled={busy}
                onClick={() =>
                  recording ? media.current?.stop() : void record()
                }
              >
                {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
                {recording
                  ? `녹음 종료 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                  : "회의 녹음"}
              </button>
              <label className="secondary file-button">
                <Upload size={16} /> 녹음 첨부
                <input
                  hidden
                  type="file"
                  accept="audio/*,video/webm"
                  disabled={busy || recording}
                  onChange={(e) => {
                    const f = Array.from(e.target.files || []);
                    setBusy(true);
                    void onFiles(f)
                      .catch((err) => setError(err.message))
                      .finally(() => setBusy(false));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {audio.map((f) => (
              <div className="audio-row" key={f.id}>
                <AudioLines size={16} />
                <span>{f.name}</span>
                <button
                  className="secondary"
                  disabled={!enabled || busy || !consent}
                  onClick={() => void ask("transcribe", f)}
                >
                  한국어 전사
                </button>
              </div>
            ))}
            <label>
              회의 메모
              <textarea
                rows={7}
                maxLength={30000}
                value={meeting.notes}
                onChange={(e) => onChange({ notes: e.target.value })}
              />
            </label>
            <label>
              음성 전사 · 직접 수정 가능
              <textarea
                rows={7}
                maxLength={60000}
                value={meeting.transcript}
                onChange={(e) => onChange({ transcript: e.target.value })}
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button
              className="primary"
              disabled={!enabled || busy || !consent || recording}
              onClick={() => void ask("summary")}
            >
              <Sparkles size={17} />
              {busy ? "처리 중…" : "현재 안건 + 메모 + 전사 정리"}
            </button>
            <p className="helper muted">
              AI 결과는 검토 후 현재 안건에 반영합니다. 담당자와 일정은 임의로
              채우지 않습니다.
            </p>
          </div>
          <aside>
            {draft ? (
              <>
                <h3>AI 초안 · 원문과 비교해 주세요.</h3>
                {(["summary", "discussion", "decisions"] as const).map((k) => (
                  <section className="ai-section" key={k}>
                    <h4>
                      {
                        {
                          summary: "핵심 요약",
                          discussion: "논의 내용",
                          decisions: "결정 사항",
                        }[k]
                      }
                    </h4>
                    {draft[k].map((v, i) => (
                      <div key={i}>
                        <p>{v.text}</p>
                        <blockquote>원문: {v.evidence}</blockquote>
                      </div>
                    ))}
                  </section>
                ))}
                <button
                  className="primary"
                  onClick={() => {
                    onApply(draft);
                    onClose();
                  }}
                >
                  검토한 초안 반영
                </button>
                <h4 className="task-proposal-heading">후속 업무 제안</h4>
                {draft.tasks.map((t, i) => (
                  <div className="ai-task-proposal" key={i}>
                    <p>{t.title}</p>
                    <small>
                      {t.owner || "담당자 미정"} · {t.due_date || "일정 미정"}
                    </small>
                    <blockquote>{t.evidence}</blockquote>
                    <button className="secondary" onClick={() => onTask(t)}>
                      확인 후 업무에 추가
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <div className="empty">
                <Sparkles />
                <h3>정리 결과가 여기에 표시됩니다.</h3>
                <p>현재 안건의 진행 내용도 함께 참고합니다.</p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
