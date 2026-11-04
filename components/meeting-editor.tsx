"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
  Printer,
  Save,
  Sparkles,
  Square,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { browserDB } from "@/lib/supabase-browser";
import {
  type Attachment,
  type Meeting,
  type Profile,
  type Revision,
  type Task,
  canWrite,
} from "@/lib/types";
import type { AIDraft } from "@/lib/ai";
const types = [
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
export default function MeetingEditor({
  meeting,
  demo,
  profile,
  people,
  allTasks,
  onClose,
  onSaved,
}: {
  meeting: Meeting;
  demo: boolean;
  profile: Profile | null;
  people: Profile[];
  allTasks: Task[];
  onClose: () => void;
  onSaved: (m: Meeting) => Promise<void>;
}) {
  const [form, setForm] = useState(meeting);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState("minutes");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [links, setLinks] = useState<{ task_id: string; carried: boolean }[]>(
    [],
  );
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null,
  );
  const [revision, setRevision] = useState<Revision | null>(null);
  const [ai, setAI] = useState<AIDraft | null>(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [localTasks, setLocalTasks] = useState(allTasks);
  const [taskOpen, setTaskOpen] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const audioPending = useRef(false);
  const taskBusy = useRef(false);
  const writable = !demo && canWrite(profile);
  const taskItems = localTasks.filter((t) =>
    links.some((l) => l.task_id === t.id),
  );
  useEffect(() => {
    setLocalTasks(allTasks);
  }, [allTasks]);
  async function refresh() {
    if (demo) return;
    const db = browserDB();
    const [a, r, l] = await Promise.all([
      db
        .from("attachments")
        .select("*")
        .eq("meeting_id", meeting.id)
        .order("created_at"),
      db
        .from("meeting_revisions")
        .select("*")
        .eq("meeting_id", meeting.id)
        .order("version", { ascending: false })
        .limit(100),
      db
        .from("meeting_tasks")
        .select("task_id,carried")
        .eq("meeting_id", meeting.id),
    ]);
    if (a.error || r.error || l.error)
      throw new Error("첨부파일 또는 이력을 불러오지 못했습니다.");
    setFiles(a.data || []);
    setRevisions(r.data || []);
    setLinks(l.data || []);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((e) => setMessage(e.message));
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [meeting.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty || recording) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, recording]);
  function change<K extends keyof Meeting>(key: K, value: Meeting[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }
  function close() {
    if (
      (dirty || recording || busy) &&
      !window.confirm(
        "저장되지 않은 내용이나 진행 중인 작업이 있습니다. 닫을까요?",
      )
    )
      return;
    onClose();
  }
  async function save(status: "draft" | "final") {
    setBusy(true);
    setMessage("");
    try {
      if (status === "final" && !form.ai_reviewed)
        throw new Error(
          "회의록의 내용과 담당자, 수치, 일정을 검토한 뒤 확인란을 선택해 주세요.",
        );
      const db = browserDB();
      const { data, error } = await db
        .from("meetings")
        .update({
          meeting_date: form.meeting_date,
          title: form.title,
          product: form.product,
          agenda: form.agenda,
          notes: form.notes,
          transcript: form.transcript,
          summary: form.summary,
          discussion: form.discussion,
          decisions: form.decisions,
          status,
          ai_reviewed: form.ai_reviewed,
        })
        .eq("id", form.id)
        .eq("version", form.version)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error(
          "다른 직원이 먼저 수정했습니다. 작성 내용을 별도로 복사하고 회의록을 다시 열어 주세요.",
        );
      setForm(data);
      setDirty(false);
      setMessage(
        status === "final" ? "회의록을 확정했습니다." : "임시저장했습니다.",
      );
      await onSaved(data);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (!writable) return;
    const mime = file.type.split(";")[0];
    if (!types.includes(mime))
      throw new Error(
        "JPG, PNG, WebP, PDF 또는 지원되는 녹음파일만 첨부할 수 있습니다.",
      );
    if (!file.size || file.size > 20 * 1024 * 1024)
      throw new Error("파일은 0바이트보다 크고 20MB 이하여야 합니다.");
    const db = browserDB();
    const ext: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "application/pdf": "pdf",
      "audio/webm": "webm",
      "video/webm": "webm",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/ogg": "ogg",
    };
    const path = `${form.id}/${crypto.randomUUID()}.${ext[mime]}`;
    const { error } = await db.storage
      .from("meeting-files")
      .upload(path, file, { contentType: mime, upsert: false });
    if (error) throw error;
    const r = await db.from("attachments").insert({
      meeting_id: form.id,
      path,
      name: file.name.slice(0, 240),
      mime_type: mime,
      size: file.size,
    });
    if (r.error)
      throw new Error(
        "파일은 저장됐지만 연결 정보 저장에 실패했습니다. 관리자에게 문의해 주세요. 중복 업로드하지 마세요.",
      );
    await refresh();
  }
  async function selectFiles(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) await upload(file);
      setMessage("첨부파일을 저장했습니다.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setBusy(false);
    }
  }
  async function openFile(f: Attachment, image = false) {
    try {
      const { data, error } = await browserDB()
        .storage.from("meeting-files")
        .createSignedUrl(f.path, 60, image ? {} : { download: f.name });
      if (error) throw error;
      if (image) setPreview({ url: data.signedUrl, name: f.name });
      else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setMessage(
        "파일을 열 수 없습니다. 권한 또는 파일 보관 상태를 확인해 주세요.",
      );
    }
  }
  async function askAI(kind: "summary" | "transcribe", attachment_id?: string) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          meeting_id: form.id,
          notes: form.notes,
          transcript: form.transcript,
          attachment_id,
          consent,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (kind === "transcribe") {
        change(
          "transcript",
          [form.transcript, data.text].filter(Boolean).join("\n\n"),
        );
        setMessage("전사 결과를 확인한 뒤 임시저장해 주세요.");
      } else {
        setAI(data.draft);
        setMessage(
          "근거를 확인하고 초안을 반영해 주세요. AI는 실제 사실과 다르게 정리할 수 있습니다.",
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "AI 요청 실패");
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (!consent) {
      setMessage("참석자의 녹음 동의 및 AI 처리 확인란을 먼저 선택해 주세요.");
      return;
    }
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "녹음을 지원하는 HTTPS 브라우저를 사용하거나 기존 녹음파일을 첨부해 주세요.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mime)
        throw new Error(
          "지원되는 녹음 형식이 없습니다. 기존 녹음파일을 첨부해 주세요.",
        );
      const media = new MediaRecorder(stream.current, { mimeType: mime });
      recorder.current = media;
      const chunks: Blob[] = [];
      let size = 0;
      media.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
        }
        if (size > 19 * 1024 * 1024 && media.state === "recording")
          media.stop();
      };
      media.onerror = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setMessage("녹음 중 오류가 발생했습니다. 마이크를 확인해 주세요.");
      };
      media.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        setBusy(true);
        try {
          await upload(
            new File(
              chunks,
              `회의녹음-${Date.now()}.${mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm"}`,
              { type: mime },
            ),
          );
          setMessage(
            "녹음파일을 저장했습니다. 파일 옆 한국어 전사 버튼을 눌러 주세요.",
          );
        } catch (e) {
          setMessage(e instanceof Error ? e.message : "녹음 저장 실패"); // Offer local recovery for recording if upload fails.
          const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
          const a = document.createElement("a");
          a.href = url;
          a.download = `회의녹음-복구.${mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm"}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        } finally {
          setBusy(false);
          audioPending.current = false;
        }
      };
      setRecordSeconds(0);
      media.start(1000);
      audioPending.current = true;
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setMessage(
        e instanceof Error ? e.message : "마이크 사용 권한을 확인해 주세요.",
      );
    }
  }
  async function editTask(t: Task, patch: Partial<Task>) {
    const r = await browserDB()
      .from("tasks")
      .update(patch)
      .eq("id", t.id)
      .select()
      .single();
    if (r.error) setMessage("업무 수정에 실패했습니다.");
    else
      setLocalTasks((items) => items.map((x) => (x.id === t.id ? r.data : x)));
  }
  return (
    <div className="modal-backdrop editor-backdrop">
      <section
        className="modal editor"
        role="dialog"
        aria-modal="true"
        aria-label="회의록 상세"
      >
        <header className="editor-header">
          <div>
            <span className="eyebrow">WEEKLY CONFERENCE · v{form.version}</span>
            <h2>{form.title}</h2>
            <p>
              {form.meeting_date} · {form.product || "공통"}{" "}
              <span
                className={`badge ${form.status === "final" ? "green" : "orange"}`}
              >
                {form.status === "final" ? "확정" : "작성 중"}
              </span>
              {dirty && <small> · 저장되지 않은 변경</small>}
            </p>
          </div>
          <div className="editor-actions">
            <button
              className="secondary"
              onClick={() => {
                setTab("minutes");
                setTimeout(() => window.print(), 100);
              }}
            >
              <Printer size={16} /> 인쇄 / PDF
            </button>
            <button
              className="icon-button"
              aria-label="회의록 닫기"
              onClick={close}
            >
              <X />
            </button>
          </div>
        </header>
        <div className="editor-tabs no-print">
          {[
            ["minutes", "회의록"],
            ["files", `첨부자료 ${files.length}`],
            ["ai", "녹음 · AI 작성"],
            ["tasks", `연결된 업무 ${taskItems.length}`],
            ["history", "수정 이력"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {message && (
          <div className="notice no-print" role="status">
            {message}
          </div>
        )}
        {demo && (
          <div className="demo-banner no-print">
            샘플 회의록 · 읽기 전용 미리보기입니다.
          </div>
        )}
        <div className="editor-body">
          {tab === "minutes" && (
            <div className="minutes-grid">
              <div className="minutes-main">
                <div className="form-grid">
                  <label>
                    회의 날짜
                    <input
                      type="date"
                      disabled={!writable}
                      value={form.meeting_date}
                      onChange={(e) => change("meeting_date", e.target.value)}
                    />
                  </label>
                  <label>
                    제품명
                    <input
                      disabled={!writable}
                      value={form.product}
                      onChange={(e) => change("product", e.target.value)}
                    />
                  </label>
                </div>
                <label>
                  회의 제목
                  <input
                    disabled={!writable}
                    value={form.title}
                    maxLength={200}
                    onChange={(e) => change("title", e.target.value)}
                  />
                </label>
                {(
                  [
                    ["agenda", "안건", "오늘 논의할 주요 안건"],
                    [
                      "summary",
                      "회의 핵심 요약",
                      "이번 회의의 핵심을 간결하게 기록하세요.",
                    ],
                    [
                      "discussion",
                      "주요 논의 내용",
                      "제품별 진행 현황과 주요 논의 사항",
                    ],
                    [
                      "decisions",
                      "확정된 결정 사항",
                      "실제로 합의한 결정 사항만 기록하세요.",
                    ],
                  ] as const
                ).map(([key, title, placeholder], i) => (
                  <section className="writing-section" key={key}>
                    <h3>
                      <span>0{i + 1}</span>
                      {title}
                    </h3>
                    <textarea
                      className="no-print"
                      rows={key === "discussion" ? 6 : 3}
                      disabled={!writable}
                      placeholder={placeholder}
                      value={form[key]}
                      onChange={(e) => change(key, e.target.value)}
                    />
                    <div className="print-only preserve">
                      {form[key] || "기록 없음"}
                    </div>
                  </section>
                ))}
                <section className="writing-section">
                  <h3>연결된 후속 업무</h3>
                  {taskItems.length === 0 ? (
                    <p className="muted">
                      업무 탭에서 담당자와 완료 예정일을 등록하세요.
                    </p>
                  ) : (
                    taskItems.map((t) => (
                      <p key={t.id}>
                        {t.title} ·{" "}
                        {people.find((p) => p.id === t.owner_id)?.name ||
                          "담당자 미정"}{" "}
                        · {t.due_date || "일정 미정"} ·{" "}
                        {
                          { todo: "진행 전", doing: "진행 중", done: "완료" }[
                            t.status
                          ]
                        }
                      </p>
                    ))
                  )}
                </section>
              </div>
              <aside className="minutes-side no-print">
                <div className="info-box">
                  <ShieldIcon />
                  <h3>함께 확인하는 회의록</h3>
                  <p>
                    제품명, 측정 수치, 담당자와 일정은 원본 자료를 기준으로
                    확인하세요.
                  </p>
                  <p>
                    첨부자료는 비공개로 보관됩니다. 파일 링크는 60초 후
                    만료됩니다.
                  </p>
                </div>
                <div className="info-box">
                  <History size={19} />
                  <h3>변경 내용은 이력으로</h3>
                  <p>
                    저장할 때마다 버전이 기록됩니다. 동시 수정은 버전 검사로
                    보호합니다.
                  </p>
                </div>
              </aside>
            </div>
          )}
          {tab === "files" && (
            <>
              <div className="section-heading">
                <div>
                  <h3>제품 사진 및 첨부자료</h3>
                  <p className="muted">
                    JPG, PNG, WebP, PDF, 녹음파일 · 파일당 최대 20MB
                  </p>
                </div>
                {writable && (
                  <label className="secondary file-button">
                    <Upload size={16} /> 파일 첨부
                    <input
                      hidden
                      type="file"
                      multiple
                      accept={types.join(",")}
                      disabled={busy}
                      onChange={(e) => {
                        void selectFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="file-grid">
                {files.map((f) => (
                  <article className="file-card" key={f.id}>
                    <button
                      className="file-visual"
                      onClick={() =>
                        void openFile(f, f.mime_type.startsWith("image/"))
                      }
                    >
                      {f.mime_type.startsWith("image/") ? (
                        <PrivateThumbnail file={f} />
                      ) : f.mime_type.includes("pdf") ? (
                        <FileText size={40} />
                      ) : (
                        <AudioLines size={40} />
                      )}
                    </button>
                    <strong>{f.name}</strong>
                    <small>
                      {(f.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                      {f.created_at.slice(0, 10)}
                    </small>
                    <button
                      className="text-button"
                      onClick={() => void openFile(f)}
                    >
                      <Download size={14} /> 다운로드
                    </button>
                  </article>
                ))}
              </div>
              {files.length === 0 && (
                <div className="empty">
                  <Paperclip size={28} />
                  <h3>회의에 필요한 자료를 한곳에.</h3>
                  <p>
                    {demo
                      ? "Supabase 연결 후 사진과 파일을 첨부할 수 있습니다."
                      : "제품 사진과 측정 결과, PDF 자료를 첨부해 주세요."}
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "ai" && (
            <div className="ai-layout">
              <div>
                <div className="info-box">
                  <Sparkles size={21} />
                  <h3>자료를 바탕으로, 검토 가능한 초안</h3>
                  <p>
                    메모와 음성 전사를 함께 정리합니다. 근거가 없는
                    담당자·일정은 미정으로 남깁니다. AI 결과는 자동 확정되지
                    않습니다.
                  </p>
                </div>
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={!writable}
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    참석자에게 녹음 동의를 받았으며, 사내 정책에 따라
                    메모·음성이 OpenAI로 전송되는 것을 확인했습니다. 민감정보는
                    제거했습니다.
                  </span>
                </label>
                <div className="record-toolbar">
                  <button
                    className={recording ? "danger" : "secondary"}
                    disabled={!writable || busy}
                    onClick={() =>
                      recording ? recorder.current?.stop() : void record()
                    }
                  >
                    {recording ? <Square size={16} /> : <Mic size={16} />}{" "}
                    {recording
                      ? `녹음 종료 · ${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`
                      : "브라우저 녹음"}
                  </button>
                  <label className="secondary file-button">
                    <Upload size={15} /> 녹음 업로드
                    <input
                      type="file"
                      hidden
                      accept="audio/*,video/webm"
                      disabled={!writable || busy || recording}
                      onChange={(e) => {
                        void selectFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {files
                  .filter(
                    (f) =>
                      f.mime_type.startsWith("audio/") ||
                      f.mime_type === "video/webm",
                  )
                  .map((f) => (
                    <div className="audio-row" key={f.id}>
                      <AudioLines size={17} />
                      <span>{f.name}</span>
                      <button
                        className="secondary"
                        disabled={!writable || busy || !consent}
                        onClick={() => void askAI("transcribe", f.id)}
                      >
                        한국어 전사
                      </button>
                    </div>
                  ))}
                <label>
                  직접 작성한 메모
                  <textarea
                    disabled={!writable || busy}
                    rows={8}
                    maxLength={30000}
                    placeholder="회의 중 메모를 자유롭게 작성하세요. 담당자와 일정은 명확하게 적어 주세요."
                    value={form.notes}
                    onChange={(e) => change("notes", e.target.value)}
                  />
                </label>
                <label>
                  한국어 전사 내용
                  <textarea
                    disabled={!writable || busy}
                    rows={8}
                    maxLength={60000}
                    placeholder="전사 결과가 여기에 표시됩니다. 잘못 인식된 제품명과 수치는 직접 수정하세요."
                    value={form.transcript}
                    onChange={(e) => change("transcript", e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!writable || busy || !consent || recording}
                  onClick={() => void askAI("summary")}
                >
                  <Sparkles size={16} />
                  {busy ? "자료 처리 중…" : "메모 + 전사로 AI 초안 작성"}
                </button>
                <p className="muted">
                  개인별 하루 초안 20회 · 전사 10회 / 회사 전체 100회. 실패
                  요청도 한도에 포함됩니다.
                </p>
              </div>
              <aside>
                {ai ? (
                  <div className="ai-result">
                    <div className="section-heading">
                      <h3>AI 초안 · 검토 필요</h3>
                      <Sparkles size={18} />
                    </div>
                    {(["summary", "discussion", "decisions"] as const).map(
                      (k) => (
                        <section key={k}>
                          <h4>
                            {
                              {
                                summary: "핵심 요약",
                                discussion: "주요 논의",
                                decisions: "결정 사항",
                              }[k]
                            }
                          </h4>
                          {ai[k].length === 0 ? (
                            <p className="muted">명시된 내용 없음</p>
                          ) : (
                            ai[k].map((item, i) => (
                              <div key={i}>
                                <p>{item.text}</p>
                                <blockquote>근거: {item.evidence}</blockquote>
                              </div>
                            ))
                          )}
                        </section>
                      ),
                    )}
                    <h4>후속 업무 제안</h4>
                    {ai.tasks.map((t, i) => (
                      <div key={i}>
                        <p>
                          {t.title} · {t.owner || "담당자 미정"} ·{" "}
                          {t.due_date || "일정 미정"}
                        </p>
                        <blockquote>{t.evidence}</blockquote>
                        <small>업무 탭에서 확인 후 직접 등록하세요.</small>
                      </div>
                    ))}
                    <button
                      className="primary"
                      disabled={!writable}
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          summary: ai.summary.map((x) => x.text).join("\n"),
                          discussion: ai.discussion
                            .map((x) => x.text)
                            .join("\n"),
                          decisions: ai.decisions.map((x) => x.text).join("\n"),
                          ai_reviewed: false,
                        }));
                        setDirty(true);
                        setTab("minutes");
                        setMessage(
                          "초안을 편집기에 반영했습니다. 담당자와 일정, 수치를 검토하고 저장하세요.",
                        );
                      }}
                    >
                      초안을 회의록에 반영
                    </button>
                  </div>
                ) : (
                  <div className="empty">
                    <Sparkles />
                    <h3>AI 초안이 여기에 표시됩니다.</h3>
                    <p>원문 인용과 함께 검토할 수 있습니다.</p>
                  </div>
                )}
              </aside>
            </div>
          )}
          {tab === "tasks" && (
            <>
              <div className="section-heading">
                <div>
                  <h3>후속 업무 및 이전 회의 미완료 업무</h3>
                  <p className="muted">
                    이월된 업무도 같은 업무입니다. 상태 변경은 연결된 모든
                    회의에 반영됩니다.
                  </p>
                </div>
                {writable && (
                  <button
                    className="secondary"
                    onClick={() => setTaskOpen(!taskOpen)}
                  >
                    <Plus size={16} /> 업무 등록
                  </button>
                )}
              </div>
              {taskOpen && (
                <form
                  className="task-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (taskBusy.current) return;
                    taskBusy.current = true;
                    setBusy(true);
                    try {
                      const f = new FormData(e.currentTarget);
                      const { data, error } = await browserDB().rpc(
                        "add_meeting_task",
                        {
                          p_meeting: form.id,
                          p_title: f.get("title"),
                          p_product: f.get("product"),
                          p_owner: f.get("owner") || null,
                          p_due: f.get("due") || null,
                        },
                      );
                      if (error) throw error;
                      const task = await browserDB()
                        .from("tasks")
                        .select("*")
                        .eq("id", data)
                        .single();
                      if (task.error) throw task.error;
                      setLocalTasks((items) => [
                        ...items.filter((x) => x.id !== task.data.id),
                        task.data,
                      ]);
                      setTaskOpen(false);
                      await refresh();
                      setMessage(
                        "업무를 등록했습니다. 동일 제목·제품·담당자의 업무는 중복 생성하지 않습니다.",
                      );
                    } catch {
                      setMessage("업무 등록에 실패했습니다.");
                    } finally {
                      setBusy(false);
                      taskBusy.current = false;
                    }
                  }}
                >
                  <label>
                    업무 내용
                    <input name="title" required maxLength={500} />
                  </label>
                  <div className="form-grid">
                    <label>
                      제품명
                      <input name="product" defaultValue={form.product} />
                    </label>
                    <label>
                      담당자
                      <select name="owner">
                        <option value="">미지정</option>
                        {people
                          .filter((p) => p.active)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      완료 예정일
                      <input type="date" name="due" />
                    </label>
                  </div>
                  <button className="primary" disabled={busy}>
                    등록
                  </button>
                </form>
              )}
              {taskItems.map((t) => (
                <article className="linked-task" key={t.id}>
                  <div>
                    <h3>{t.title}</h3>
                    <small>
                      {t.product || "공통"}{" "}
                      {links.find((l) => l.task_id === t.id)?.carried && (
                        <span className="badge orange">이전 회의에서 이월</span>
                      )}
                    </small>
                  </div>
                  <div className="form-grid">
                    <label>
                      담당자
                      <select
                        disabled={!writable}
                        value={t.owner_id || ""}
                        onChange={(e) =>
                          void editTask(t, { owner_id: e.target.value || null })
                        }
                      >
                        <option value="">미지정</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      완료 예정일
                      <input
                        disabled={!writable}
                        type="date"
                        value={t.due_date || ""}
                        onChange={(e) =>
                          void editTask(t, { due_date: e.target.value || null })
                        }
                      />
                    </label>
                    <label>
                      상태
                      <select
                        disabled={!writable}
                        value={t.status}
                        onChange={(e) =>
                          void editTask(t, {
                            status: e.target.value as Task["status"],
                          })
                        }
                      >
                        <option value="todo">진행 전</option>
                        <option value="doing">진행 중</option>
                        <option value="done">완료</option>
                      </select>
                    </label>
                  </div>
                </article>
              ))}
              {taskItems.length === 0 && (
                <div className="empty">연결된 업무가 없습니다.</div>
              )}
            </>
          )}
          {tab === "history" && (
            <>
              <h3>저장된 회의록 수정 이력</h3>
              <p className="muted">
                최근 100개 버전 표시 · DB에는 전체 이력이 보존됩니다. 이전
                내용을 확인하고 필요한 부분을 직접 반영하세요.
              </p>
              {revisions.map((r) => (
                <button
                  className="history-link"
                  key={r.id}
                  onClick={() => setRevision(r)}
                >
                  <span>
                    <strong>버전 {r.version}</strong>
                    {new Date(r.created_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}{" "}
                    ·{" "}
                    {people.find((p) => p.id === r.changed_by)?.name || "직원"}
                  </span>
                  <History size={17} />
                </button>
              ))}
              {revision && (
                <div className="info-box">
                  <div className="section-heading">
                    <h3>버전 {revision.version} 내용</h3>
                    <button
                      className="icon-button"
                      aria-label="이전 버전 닫기"
                      onClick={() => setRevision(null)}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {(
                    [
                      "title",
                      "meeting_date",
                      "product",
                      "agenda",
                      "summary",
                      "discussion",
                      "decisions",
                      "notes",
                      "transcript",
                    ] as const
                  ).map((k) => (
                    <p className="preserve" key={k}>
                      <strong>
                        {
                          {
                            title: "제목",
                            meeting_date: "날짜",
                            product: "제품",
                            agenda: "안건",
                            summary: "요약",
                            discussion: "논의",
                            decisions: "결정",
                            notes: "메모",
                            transcript: "전사",
                          }[k]
                        }
                      </strong>
                      <br />
                      {revision.snapshot[k] || "없음"}
                    </p>
                  ))}
                </div>
              )}
              {revisions.length === 0 && (
                <div className="empty">
                  {demo
                    ? "샘플에는 실제 수정 이력이 없습니다."
                    : "아직 표시할 이력이 없습니다."}
                </div>
              )}
            </>
          )}
        </div>
        {writable && (
          <footer className="editor-footer no-print">
            <label className="consent">
              <input
                type="checkbox"
                checked={form.ai_reviewed}
                onChange={(e) => change("ai_reviewed", e.target.checked)}
              />
              <span>제품명·수치·담당자·일정과 회의록 내용을 검토했습니다.</span>
            </label>
            <div>
              <button
                className="secondary"
                disabled={busy || recording}
                onClick={() => void save("draft")}
              >
                <Save size={16} /> 임시저장
              </button>
              <button
                className="primary"
                disabled={
                  busy || recording || !form.ai_reviewed || !form.title.trim()
                }
                onClick={() => void save("final")}
              >
                <Check size={16} /> 검토 후 확정
              </button>
            </div>
          </footer>
        )}
      </section>
      {preview && (
        <div
          className="image-lightbox"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label="이미지 확대"
        >
          <button className="icon-button" aria-label="이미지 닫기">
            <X />
          </button>
          <img src={preview.url} alt={preview.name} />
          <p>{preview.name} · 링크 유효시간 60초</p>
        </div>
      )}
    </div>
  );
}
function ShieldIcon() {
  return <Check size={20} />;
}
function PrivateThumbnail({ file }: { file: Attachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    void browserDB()
      .storage.from("meeting-files")
      .createSignedUrl(file.path, 60)
      .then(({ data }: { data: { signedUrl: string } | null }) => {
        if (active && data) setUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [file.path]);
  return url ? (
    <img src={url} alt={file.name} loading="lazy" onError={() => setUrl("")} />
  ) : (
    <ImageIcon size={40} />
  );
}
