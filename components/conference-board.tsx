"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Edit3,
  History,
  Image as ImageIcon,
  Layers,
  Mic,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Square,
  Upload,
  Trash2,
  RotateCcw,
  Columns2,
  X,
} from "lucide-react";
import {
  addTask,
  boardSchema,
  categoryLabels,
  carryMeeting,
  agendaChangedFields,
  previousAgenda,
  deleteAgenda,
  restoreAgenda,
  conferenceTabs,
  emptyBoard,
  fileMimes,
  insertMeeting,
  isCategory,
  meetingFiles,
  newMeeting,
  reviewLabels,
  type Agenda,
  type Board,
  type Category,
  type Recording,
  type Session,
  type Snapshot,
  type StoredBoard,
  type Visual,
} from "@/lib/conference";
import {
  clearRecordingRecovery,
  findRecordingRecovery,
  loadBoard,
  mode as detectMode,
  revisions,
  saveFile,
  saveWithMerge,
  type StorageMode,
} from "@/lib/conference-storage";
import { mergeBoards } from "@/lib/conference-merge";
import {
  exportBackup,
  materializeSlides,
  presentationDate,
  readPresentation,
  restoreBackup,
  type ImportedSlide,
} from "@/lib/conference-import";
import { summarizeRecording, type AIRequest } from "@/lib/recording-pipeline";
import {
  useMeetingRecorder,
  type CapturedPart,
} from "@/hooks/use-meeting-recorder";
import { type AIDraft } from "@/lib/ai";
import {
  AssetImage,
  CompareDialog,
  downloadBlob,
  ReviewDialog,
} from "./conference-assets";
import AgendaEntry from "./agenda-entry";
import { AgendaComparison, LegacyPlan, MeetingText } from "./meeting-text";
import RecordingTab from "./recording-tab";
import ProjectOverview, { ProjectNavigator } from "./project-overview";
const labels = { ...categoryLabels, recordings: "회의 녹음 내용" };
export default function ConferenceBoard() {
  const [store, setStore] = useState<StoredBoard>({
    version: 0,
    data: emptyBoard(),
  });
  const current = useRef(store);
  const baseline = useRef<Board>(emptyBoard());
  const [mode, setMode] = useState<StorageMode>("local");
  const modeRef = useRef<StorageMode>("local");
  const [ready, setReady] = useState(false);
  const [accessible, setAccessible] = useState(true);
  const [ai, setAI] = useState(false);
  const aiRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [tab, setTab] = useState<Category | "recordings">("development");
  const [query, setQuery] = useState("");
  const [expandedAll, setExpandedAll] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [comparisonAgenda, setComparisonAgenda] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const [entry, setEntry] = useState<{
    initial: Agenda | null;
    category: Category;
    editorKey?: string;
  } | null>(null);
  const [metadata, setMetadata] = useState(false);
  const [nextSession, setNextSession] = useState<{
    sourceId: string;
    date: string;
  } | null>(null);
  const [startDialog, setStartDialog] = useState(false);
  const [consent, setConsent] = useState(false);
  const [review, setReview] = useState<{
    agendaId: string;
    file: Visual;
  } | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);
  const [tools, setTools] = useState(false);
  const [history, setHistory] = useState<Snapshot[] | null>(null);
  const [oldVersion, setOldVersion] = useState<Snapshot | null>(null);
  const [slides, setSlides] = useState<ImportedSlide[] | null>(null);
  const [importIds, setImportIds] = useState<number[]>([]);
  const [importDate, setImportDate] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const pipeline = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<() => void>(() => {});
  const meeting =
    store.data.meetings.find((m) => m.id === meetingId) ||
    store.data.meetings[0];
  const visible =
    meeting?.agenda.filter(
      (a) =>
        !a.deletedAt &&
        a.category === tab &&
        (!changedOnly ||
          !a.carriedFrom ||
          agendaChangedFields(a, previousAgenda(store.data, a)).length > 0) &&
        `${a.title} ${a.product} ${a.report} ${a.plan} ${a.decision}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  const legacy =
    meeting?.agenda.filter((a) => !a.deletedAt && !isCategory(a.category)) ||
    [];
  const design = visible.flatMap((a) =>
    a.visuals
      .filter((v) => v.mime.startsWith("image/"))
      .map((file) => ({ agenda: a, file })),
  );
  const compareFiles =
    meeting?.agenda
      .filter((a) => !a.deletedAt && a.category === "design")
      .flatMap((a) => a.visuals)
      .filter((v) => compareIds.includes(v.id)) || [];
  function update(fn: (b: Board) => Board) {
    const next = { ...current.current, data: fn(current.current.data) };
    current.current = next;
    setStore(next);
    setDirty(true);
    setNotice("");
  }
  function mutateMeeting(id: string, fn: (m: Session) => Session) {
    update((b) => ({
      ...b,
      meetings: b.meetings.map((m) => (m.id === id ? fn(m) : m)),
    }));
  }
  function changeRecording(
    mid: string,
    rid: string,
    patch: Partial<Recording>,
  ) {
    mutateMeeting(mid, (m) => ({
      ...m,
      recordings: m.recordings.map((r) =>
        r.id === rid ? { ...r, ...patch } : r,
      ),
    }));
  }
  function getMeeting(id: string) {
    const found = current.current.data.meetings.find((m) => m.id === id);
    if (!found) throw new Error("회의를 찾을 수 없습니다.");
    return found;
  }
  async function persist(showNotice = true) {
    setSaving((n) => n + 1);
    const run = queue.current.then(async () => {
      const sent = current.current;
      const result = await saveWithMerge(
        modeRef.current,
        sent,
        baseline.current,
      );
      const now = current.current;
      const changed = now.data !== sent.data;
      const data = changed
        ? mergeBoards(sent.data, now.data, result.data)
        : result.data;
      baseline.current = result.data;
      current.current = { version: result.version, data };
      setStore(current.current);
      setDirty(changed);
      if (showNotice) {
        setNotice("회의 내용을 저장했습니다.");
        setError("");
      }
      return result;
    });
    queue.current = run.catch(() => {});
    try {
      return await run;
    } finally {
      setSaving((n) => n - 1);
    }
  }
  async function manualSave() {
    try {
      await persist();
    } catch (e) {
      setError(message(e));
    }
  }
  saveRef.current = () => void manualSave();
  async function uploadVisual(id: string, file: File): Promise<Visual> {
    const mime = file.type.split(";")[0];
    if (!fileMimes.includes(mime) || !file.size || file.size > 20 * 1024 * 1024)
      throw new Error(
        "지원하는 이미지·PDF·오디오를 파일당 20MB 이하로 선택해 주세요.",
      );
    const normalized = new File([file], file.name, { type: mime });
    const path = await saveFile(modeRef.current, id, normalized, file.name);
    return {
      id,
      path,
      name: file.name,
      mime,
      size: file.size,
      label: file.name.replace(/\.[^.]+$/, ""),
      status: "pending",
      comment: "",
      reviewer: "",
      reviewedAt: "",
      history: [],
    };
  }
  async function saveCaptured(mid: string, rid: string, part: CapturedPart) {
    const visual = {
      ...(await uploadVisual(part.id, part.file)),
      sequence: part.sequence,
    };
    mutateMeeting(mid, (m) => ({
      ...m,
      recordings: m.recordings.map((r) =>
        r.id === rid
          ? {
              ...r,
              parts: r.parts.some((v) => v.id === visual.id)
                ? r.parts
                : [...r.parts, visual].sort(
                    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
                  ),
            }
          : r,
      ),
    }));
    await persist(false);
    await clearRecordingRecovery(part.recoveryKey);
  }
  const requestAI: AIRequest = async (body) => {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: pipeline.current?.signal,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "AI 처리에 실패했습니다.");
    return data;
  };
  async function processRecording(mid: string, rid: string) {
    if (processing) return;
    setProcessing(true);
    pipeline.current = new AbortController();
    setError("");
    try {
      let r = getMeeting(mid).recordings.find((r) => r.id === rid);
      if (!r) throw new Error("녹음을 찾을 수 없습니다.");
      if (!r.parts.length)
        throw new Error(
          "저장된 녹음 구간이 없습니다. 복구 확인 또는 기존 녹음 추가를 사용해 주세요.",
        );
      if (!aiRef.current) {
        changeRecording(mid, rid, {
          status: "needs_setup",
          error:
            "원본 녹음은 저장되었습니다. Supabase 팀 공유 및 OpenAI 연결 후 다시 정리를 눌러 주세요.",
        });
        await persist(false);
        return;
      }
      changeRecording(mid, rid, { status: "processing", error: "" });
      await persist(false);
      r = getMeeting(mid).recordings.find((r) => r.id === rid)!;
      await summarizeRecording({
        meetingId: mid,
        recording: r,
        notes: getMeeting(mid).notes,
        request: requestAI,
        signal: pipeline.current.signal,
        checkpoint: async (next) => {
          changeRecording(mid, rid, next);
          await persist(false);
        },
      });
      setNotice("회의 녹음과 취합 요약을 자동으로 저장했습니다.");
    } catch (e) {
      const text = message(e);
      changeRecording(mid, rid, { status: "failed", error: text });
      try {
        await persist(false);
      } catch {
        setError(
          "요약 상태를 저장하지 못했습니다. 원본과 현재 내용을 확인한 뒤 회의자료 저장을 눌러 주세요.",
        );
      }
    } finally {
      setProcessing(false);
      pipeline.current = null;
    }
  }
  const recorder = useMeetingRecorder({
    onError: setError,
    onStarted: async (mid, rid) => {
      const r: Recording = {
        id: rid,
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationSeconds: 0,
        status: "recording",
        consent: true,
        parts: [],
        transcribedPartIds: [],
        transcript: "",
        draft: null,
        error: "",
        reviewed: false,
      };
      mutateMeeting(mid, (m) => ({ ...m, recordings: [...m.recordings, r] }));
      await persist(false);
    },
    onPart: saveCaptured,
    onFinish: async (mid, rid, seconds, failed) => {
      changeRecording(mid, rid, {
        endedAt: new Date().toISOString(),
        durationSeconds: seconds,
        status: failed ? "failed" : "processing",
        error: failed
          ? "일부 구간 저장에 실패했습니다. 녹음 복구 확인을 눌러 주세요."
          : "",
      });
      await persist(false);
      setMeetingId(mid);
      setTab("recordings");
      if (!failed) await processRecording(mid, rid);
    },
  });
  const locked = recorder.phase !== "idle" || processing;
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const info = await detectMode();
        if (!mounted) return;
        setMode(info.mode);
        modeRef.current = info.mode;
        setAccessible(info.accessible);
        setAI(info.ai);
        aiRef.current = info.ai;
        if (info.accessible) {
          const data = await loadBoard(info.mode);
          if (!mounted) return;
          current.current = data;
          baseline.current = data.data;
          setStore(data);
          setMeetingId(data.data.meetings[0]?.id || "");
        }
      } catch (e) {
        if (mounted) {
          setAccessible(false);
          setError(message(e));
        }
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
      pipeline.current?.abort();
    };
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty || locked) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("keydown", key);
    };
  }, [dirty, locked]);
  async function newSession(blank = false) {
    if (meeting && !blank) {
      openNextSession();
      return;
    }
    const m = newMeeting();
    update((b) => insertMeeting(b, m));
    setMeetingId(m.id);
    setTab("development");
    setMetadata(true);
  }
  function openNextSession() {
    if (!meeting || locked) return;
    const d = new Date(meeting.date + "T12:00:00");
    d.setDate(d.getDate() + 7);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const existing = current.current.data.meetings.find(
      (m) => m.copiedFrom === meeting.id,
    );
    setNextSession({ sourceId: meeting.id, date: existing?.date || date });
  }
  async function prepareNext() {
    if (!nextSession || locked || preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    try {
      const { sourceId, date } = nextSession;
      const originalIds = new Set(
        current.current.data.meetings.map((m) => m.id),
      );
      update((b) => carryMeeting(b, getMeeting(sourceId), date));
      const next = current.current.data.meetings[0];
      setMeetingId(next.id);
      setCompareIds([]);
      setChangedOnly(false);
      setQuery("");
      if (tab === "recordings") setTab("development");
      await persist(false);
      setNextSession(null);
      setNotice(
        originalIds.has(next.id)
          ? "이미 만들어진 회의를 열었습니다. 작성한 내용은 유지됩니다."
          : "이전 진행 내용·회의 결정·첨부자료를 이어받아 저장했습니다. 바뀐 부분만 수정하세요.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }
  async function removeEntry(a: Agenda) {
    if (
      !meeting ||
      !window.confirm(
        `‘${a.title}’ 안건을 이번 회의에서 삭제할까요? 첨부 원본과 이전 회의는 보존되며 삭제한 안건에서 복원할 수 있습니다.`,
      )
    )
      return;
    update((b) => deleteAgenda(b, meeting.id, a.id));
    try {
      await persist(false);
      setNotice("안건을 삭제했습니다. 삭제한 안건에서 복원할 수 있습니다.");
    } catch (e) {
      setError(message(e));
    }
  }
  async function restoreEntry(a: Agenda) {
    if (!meeting) return;
    update((b) => restoreAgenda(b, meeting.id, a.id));
    try {
      await persist(false);
      setNotice("안건과 첨부자료를 복원했습니다.");
    } catch (e) {
      setError(message(e));
    }
  }
  async function saveEntry(a: Agenda, files: File[]) {
    if (!meeting) throw new Error("회의를 먼저 선택해 주세요.");
    const visuals = [...a.visuals];
    for (const file of files)
      visuals.push(await uploadVisual(crypto.randomUUID(), file));
    const value = { ...a, title: a.title.trim(), visuals };
    mutateMeeting(meeting.id, (m) => ({
      ...m,
      status: "draft",
      reviewed: false,
      agenda: m.agenda.some((x) => x.id === a.id)
        ? m.agenda.map((x) => (x.id === a.id ? value : x))
        : [...m.agenda, value],
    }));
    if (isCategory(a.category)) setTab(a.category);
    await persist();
    return getMeeting(meeting.id).agenda.find((item) => item.id === a.id)!;
  }
  async function recover(r: Recording) {
    if (!meeting) return;
    setProcessing(true);
    try {
      const cached = await findRecordingRecovery(r.id);
      for (const p of cached) {
        const suffix = p.key.split("/").at(-1)!;
        const ordered = /^\d{4}-/.test(suffix);
        const id = ordered ? suffix.slice(5) : suffix;
        const sequence = ordered ? Number(suffix.slice(0, 4)) : 0;
        if (
          !getMeeting(meeting.id)
            .recordings.find((x) => x.id === r.id)!
            .parts.some((x) => x.id === id)
        )
          await saveCaptured(meeting.id, r.id, {
            id,
            file: new File(
              [p.file],
              `회의녹음-복구.${p.file.type.includes("mp4") ? "mp4" : p.file.type.includes("ogg") ? "ogg" : "webm"}`,
              { type: p.file.type },
            ),
            recoveryKey: p.key,
            sequence,
          });
        else await clearRecordingRecovery(p.key);
      }
      changeRecording(meeting.id, r.id, {
        status: "needs_setup",
        endedAt: r.endedAt || new Date().toISOString(),
        error: cached.length
          ? "저장되지 않은 녹음 구간을 복구했습니다. 다시 정리를 눌러 주세요."
          : "이 브라우저에서 추가 복구 구간을 찾지 못했습니다. 저장된 원본을 확인하고 다시 정리하거나 보관한 녹음파일을 추가해 주세요.",
      });
      await persist();
    } catch (e) {
      setError(message(e));
    } finally {
      setProcessing(false);
    }
  }
  async function attachRecording(files: File[]) {
    if (!meeting || !files.length) return;
    setProcessing(true);
    try {
      const parts: Visual[] = [];
      for (const f of files) {
        if (!f.type.startsWith("audio/") && f.type !== "video/webm")
          throw new Error("오디오 파일을 선택해 주세요.");
        parts.push(await uploadVisual(crypto.randomUUID(), f));
      }
      const r: Recording = {
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationSeconds: 0,
        status: "needs_setup",
        consent: false,
        parts,
        transcribedPartIds: [],
        transcript: "",
        draft: null,
        error: "정리 전 외부 AI 처리 동의를 확인해 주세요.",
        reviewed: false,
      };
      mutateMeeting(meeting.id, (m) => ({
        ...m,
        recordings: [...m.recordings, r],
      }));
      await persist();
    } catch (e) {
      setError(message(e));
    } finally {
      setProcessing(false);
    }
  }
  async function retry(r: Recording) {
    if (!meeting) return;
    if (
      !r.consent &&
      !window.confirm(
        "참석자 동의와 사내 정책에 따라 녹음이 OpenAI로 전송되는 것을 확인했나요?",
      )
    )
      return;
    changeRecording(meeting.id, r.id, { consent: true });
    await processRecording(meeting.id, r.id);
  }
  async function backup() {
    try {
      downloadBlob(
        await exportBackup(mode, store.data),
        `AZLA-${meeting?.date || "회의"}-백업.zip`,
      );
      setNotice("녹음과 첨부파일이 포함된 백업을 내보냈습니다.");
    } catch (e) {
      setError(message(e));
    }
  }
  async function reload() {
    if (locked) return;
    if (
      dirty &&
      !window.confirm(
        "저장하지 않은 변경이 있습니다. 백업 후 최신 내용을 불러올까요?",
      )
    )
      return;
    try {
      const value = await loadBoard(mode);
      current.current = value;
      baseline.current = value.data;
      setStore(value);
      setDirty(false);
      setNotice("최신 회의자료를 불러왔습니다.");
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }
  function patchAgenda(id: string, patch: Partial<Agenda>) {
    if (meeting)
      mutateMeeting(meeting.id, (m) => ({
        ...m,
        status: "draft",
        reviewed: false,
        agenda: m.agenda.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
  }
  return (
    <div className="meeting-app">
      <header className="meeting-app-header">
        <a href="/" className="meeting-brand">
          AZLA <span>주간회의 워크스페이스</span>
        </a>
        <div className="header-actions">
          {recorder.phase === "recording" ? (
            <>
              <span className="live-status">
                <i />
                녹음 중 {clock(recorder.seconds)}
              </span>
              <button className="danger" onClick={recorder.stop}>
                <Square size={14} /> 회의 종료
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={!meeting || locked || !ready || !accessible}
              onClick={() => {
                setConsent(false);
                setStartDialog(true);
              }}
            >
              <Mic size={16} />
              {locked ? "녹음 저장 · 정리 중…" : "회의 시작"}
            </button>
          )}
          <button
            className="secondary"
            disabled={!meeting || saving > 0}
            onClick={() => void manualSave()}
          >
            <Save size={15} />
            {saving ? "저장 중…" : "회의자료 저장"}
          </button>
        </div>
      </header>
      <main className="meeting-page">
        {!ready ? (
          <div className="empty">회의자료를 여는 중입니다…</div>
        ) : !accessible ? (
          <section className="welcome-card">
            <h1>
              {error
                ? "회의자료를 열지 못했습니다."
                : "팀 공유 링크로 들어와 주세요."}
            </h1>
            <p role={error ? "alert" : undefined}>
              {error ||
                "전달받은 공유 링크로 같은 회의자료를 함께 작성할 수 있습니다."}
            </p>
          </section>
        ) : (
          <>
            <div className="meeting-page-title">
              <div>
                <span className="eyebrow">AZLA WEEKLY CONFERENCE</span>
                <h1>{meeting?.title || "우리 팀의 주간회의"}</h1>
                <p>
                  {meeting
                    ? `${meeting.date} · ${meeting.department}`
                    : "내용을 입력하면 분류별 회의자료로 모입니다."}
                </p>
              </div>
              <div className="meeting-selector">
                {meeting && (
                  <>
                    <button
                      className="secondary date-edit-button"
                      aria-label="회의 정보 수정"
                      disabled={locked}
                      onClick={() => setMetadata(true)}
                    >
                      <CalendarDays size={16} /> 날짜 변경
                    </button>
                    <select
                      aria-label="회의 선택"
                      disabled={locked}
                      value={meeting.id}
                      onChange={(e) => {
                        setMeetingId(e.target.value);
                        setCompareIds([]);
                        setQuery("");
                      }}
                    >
                      {store.data.meetings.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.date} · {m.title}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  className="secondary"
                  disabled={locked || preparing}
                  onClick={() => void newSession()}
                >
                  <Plus size={15} />{" "}
                  {meeting
                    ? preparing
                      ? "회의 준비 중…"
                      : "다음 회의 만들기"
                    : "새 주간회의"}
                </button>
                <button
                  className="icon-button"
                  aria-label="회의 도구"
                  onClick={() => setTools(!tools)}
                >
                  <MoreHorizontal />
                </button>
              </div>
            </div>
            {mode === "local" && (
              <div className="local-banner">
                <Cloud size={15} />
                <span>
                  이 브라우저에 저장 중입니다. 팀 공동 작성과 AI 자동 요약은
                  Supabase 공유 및 OpenAI 연결 후 사용할 수 있습니다.
                </span>
              </div>
            )}
            {tools && (
              <div className="meeting-tools">
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => void reload()}
                >
                  <RefreshCw size={14} />
                  최신 불러오기
                </button>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => void newSession(true)}
                >
                  <Plus size={14} />빈 회의 만들기
                </button>
                <button className="text-button" onClick={() => void backup()}>
                  <ArrowDownToLine size={14} />
                  전체 백업
                </button>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => restoreRef.current?.click()}
                >
                  <Upload size={14} />
                  백업 복원
                </button>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />
                  PPT 가져오기
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    void revisions(mode)
                      .then(setHistory)
                      .catch((e) => setError(message(e)));
                  }}
                >
                  <History size={14} />
                  수정 이력
                </button>
                <button className="text-button" onClick={() => window.print()}>
                  <Printer size={14} />
                  인쇄 / PDF
                </button>
                {meeting && (
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={openNextSession}
                  >
                    이전 내용으로 회의 만들기
                  </button>
                )}
              </div>
            )}
            <nav className="meeting-tabs" aria-label="회의 분류" role="tablist">
              {conferenceTabs.map((t) => (
                <button
                  role="tab"
                  aria-label={labels[t]}
                  aria-selected={tab === t}
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => {
                    setTab(t);
                    setQuery("");
                    setCompareIds([]);
                  }}
                >
                  {t === "recordings" && <Mic size={15} />} {labels[t]}
                  {meeting && (
                    <small>
                      {t === "recordings"
                        ? meeting.recordings.length
                        : meeting.agenda.filter(
                            (a) => !a.deletedAt && a.category === t,
                          ).length}
                    </small>
                  )}
                </button>
              ))}
            </nav>
            {recorder.phase === "recording" && (
              <div className="recording-live-banner" role="status">
                <Mic size={20} />
                <strong>회의 녹음 중</strong>
                <span>
                  탭을 이동해도 녹음은 계속됩니다. 회의 종료 후 녹음 내용이
                  자동으로 정리됩니다.
                </span>
                <span className="live-time">{clock(recorder.seconds)}</span>
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {notice && (
              <p className="save-message" role="status">
                <Check size={15} />
                {notice}
              </p>
            )}
            {!meeting ? (
              <section className="welcome-card">
                <Layers size={40} />
                <h2>첫 주간회의를 시작하세요.</h2>
                <p>
                  회의를 만들고 각 분류에 안건과 이미지를 등록합니다.
                  <br />
                  회의 시작·종료 버튼으로 녹음과 요약을 이어갑니다.
                </p>
                <button className="primary" onClick={() => void newSession()}>
                  <Plus size={16} /> 첫 회의 만들기
                </button>
              </section>
            ) : (
              <>
                {!!legacy.length && (
                  <div className="notice">
                    이전 버전의 ‘기타 / 협력업체’ 안건 {legacy.length}개는 새
                    분류를 확인해 주세요.{" "}
                    {legacy.map((a) => (
                      <button
                        key={a.id}
                        className="text-button"
                        onClick={() =>
                          setEntry({ initial: a, category: "development" })
                        }
                      >
                        {a.title} 분류 변경
                      </button>
                    ))}
                  </div>
                )}
                {tab === "recordings" ? (
                  <RecordingTab
                    meeting={meeting}
                    mode={mode}
                    processing={locked}
                    onRetry={(r) => void retry(r)}
                    onRecover={(r) => void recover(r)}
                    onUpload={(files) => void attachRecording(files)}
                    onChange={(id, patch) =>
                      changeRecording(meeting.id, id, patch)
                    }
                    onSave={() => void manualSave()}
                    onTask={(task) => {
                      update((b) =>
                        addTask(b, meeting.id, {
                          title: task.title,
                          product: "회의 후속 업무",
                          owner: task.owner || "",
                          due: task.due_date || "",
                          status: "todo",
                        }),
                      );
                      void manualSave();
                    }}
                  />
                ) : (
                  <>
                    <div className="category-heading">
                      <div>
                        {tab !== "design" && visible.length > 1 ? (
                          <>
                            <h2 className="print-category-heading">
                              {categoryLabels[tab]}
                            </h2>
                            <ProjectNavigator agendas={visible} />
                          </>
                        ) : (
                          <h2>{categoryLabels[tab]}</h2>
                        )}
                        <p>
                          {tab === "design"
                            ? "디자인 분류로 등록한 시안과 검토 내용만 모아봅니다."
                            : `${categoryLabels[tab]} 분류의 안건만 표시합니다.`}
                        </p>
                      </div>
                      <div>
                        <label className="search-box">
                          <Search size={15} />
                          <input
                            aria-label="현재 분류 검색"
                            placeholder="현재 분류에서 검색"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                        {tab === "design" && (
                          <button
                            className="secondary"
                            disabled={compareFiles.length !== 2}
                            onClick={() => setCompare(true)}
                          >
                            <Layers size={15} />
                            시안 비교 ({compareFiles.length}/2)
                          </button>
                        )}
                        <button
                          className="primary"
                          onClick={() =>
                            setEntry({ initial: null, category: tab })
                          }
                        >
                          <Plus size={16} />{" "}
                          {tab === "design" ? "디자인 등록" : "안건 등록"}
                        </button>
                      </div>
                    </div>
                    <div className="reading-controls">
                      <span>{visible.length}개 안건</span>
                      <button
                        className="text-button trash-control"
                        aria-label="삭제한 안건"
                        onClick={() => setTrashOpen(true)}
                      >
                        <Trash2 size={13} />
                        삭제한 안건{" "}
                        {meeting.agenda.filter((a) => a.deletedAt).length}
                      </button>
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={changedOnly}
                          onChange={(e) => setChangedOnly(e.target.checked)}
                        />
                        신규·변경 안건만
                      </label>
                      <button
                        className="text-button"
                        onClick={() => setExpandedAll((v) => !v)}
                      >
                        {expandedAll ? "핵심만 보기" : "전체 내용 펼치기"}
                      </button>
                      <span className="reading-hint">
                        바뀐 문장부터 보고, 필요한 내용은 펼쳐 읽으세요.
                      </span>
                    </div>
                    {visible.length > 0 &&
                      (tab === "design" ? (
                        <div className="design-gallery">
                          {visible.map((a) => (
                            <section className="design-agenda panel" key={a.id}>
                              <div className="section-heading">
                                <div>
                                  <h3>{a.product || a.title}</h3>
                                  <MeetingText
                                    value={a.report}
                                    previous={
                                      previousAgenda(store.data, a)?.report
                                    }
                                    expanded={expandedAll}
                                    prioritizeChanges
                                  />
                                </div>
                                <button
                                  className="icon-button delete-entry-button"
                                  aria-label={`${a.title} 삭제`}
                                  onClick={() => void removeEntry(a)}
                                >
                                  <Trash2 size={15} />
                                </button>
                                <button
                                  className="text-button"
                                  aria-label={`${a.title} 수정`}
                                  onClick={() =>
                                    setEntry({ initial: a, category: "design" })
                                  }
                                >
                                  <Edit3 size={14} />
                                  내용 수정
                                </button>
                              </div>
                              <div className="visual-grid">
                                {a.visuals
                                  .filter((v) => v.mime.startsWith("image/"))
                                  .map((v) => (
                                    <article className="design-card" key={v.id}>
                                      <div className="design-card-top">
                                        <label className="compare-check">
                                          <input
                                            type="checkbox"
                                            aria-label={`${v.label} 비교 선택`}
                                            checked={compareIds.includes(v.id)}
                                            disabled={
                                              !compareIds.includes(v.id) &&
                                              compareIds.length >= 2
                                            }
                                            onChange={(e) =>
                                              setCompareIds((ids) =>
                                                e.target.checked
                                                  ? [...ids, v.id]
                                                  : ids.filter(
                                                      (id) => id !== v.id,
                                                    ),
                                              )
                                            }
                                          />
                                          비교
                                        </label>
                                        <span
                                          className={`review-badge ${v.status}`}
                                        >
                                          {v.carriedFrom ? "이전 " : ""}
                                          {reviewLabels[v.status]}
                                        </span>
                                      </div>
                                      <AssetImage
                                        mode={mode}
                                        file={v}
                                        onClick={() =>
                                          setReview({ agendaId: a.id, file: v })
                                        }
                                      />
                                      <div className="design-card-body">
                                        <strong>{v.label}</strong>
                                        <p>
                                          {v.comment ||
                                            "이미지를 눌러 확대하고 검토 의견을 남겨 주세요."}
                                        </p>
                                        <button
                                          className="primary full"
                                          onClick={() =>
                                            setReview({
                                              agendaId: a.id,
                                              file: v,
                                            })
                                          }
                                        >
                                          시안 검토
                                        </button>
                                      </div>
                                    </article>
                                  ))}
                              </div>
                              {!a.visuals.some((v) =>
                                v.mime.startsWith("image/"),
                              ) && (
                                <button
                                  className="image-dropzone"
                                  onClick={() =>
                                    setEntry({ initial: a, category: "design" })
                                  }
                                >
                                  <ImageIcon size={25} />
                                  디자인 이미지 추가
                                </button>
                              )}
                              {a.plan && <LegacyPlan value={a.plan} />}
                              {a.decision && (
                                <p className="design-decision">
                                  회의 결정: {a.decision}
                                </p>
                              )}
                            </section>
                          ))}
                        </div>
                      ) : (
                        <ProjectOverview
                          key={`${meeting.id}-${tab}`}
                          agendas={visible}
                          board={store.data}
                          mode={mode}
                          expanded={expandedAll}
                          onEdit={(a) =>
                            setEntry({ initial: a, category: tab })
                          }
                          onDelete={(a) => void removeEntry(a)}
                          onCompare={setComparisonAgenda}
                          onReview={(a, file) =>
                            setReview({ agendaId: a.id, file })
                          }
                          onError={setError}
                        />
                      ))}
                    {!visible.length && (
                      <div className="panel category-empty">
                        <h3>
                          {query
                            ? "검색 결과가 없습니다."
                            : `${categoryLabels[tab]} 안건이 없습니다.`}
                        </h3>
                        <p>
                          {query
                            ? "검색어를 바꾸어 주세요."
                            : "위의 등록 버튼으로 진행 내용, 회의 결정과 자료를 입력하세요."}
                        </p>
                      </div>
                    )}
                    <button
                      className="add-table-row"
                      onClick={() => setEntry({ initial: null, category: tab })}
                    >
                      <Plus size={15} /> {categoryLabels[tab]} 내용 추가
                    </button>
                  </>
                )}
                <div className="meeting-footer">
                  <span className={dirty ? "unsaved" : ""}>
                    {dirty
                      ? "저장하지 않은 변경이 있습니다."
                      : `저장 버전 ${store.version}`}
                  </span>
                  <span>
                    {mode === "shared"
                      ? "팀 공유 저장소"
                      : "이 브라우저에 저장"}{" "}
                    · 자동 요약은 별도 녹음 기록에 저장됩니다.
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </main>
      {entry && (
        <AgendaEntry
          key={entry.editorKey ?? entry.initial?.id ?? "new"}
          initial={entry.initial}
          category={entry.category}
          previous={
            entry.initial
              ? previousAgenda(store.data, entry.initial)
              : undefined
          }
          onClose={() => setEntry(null)}
          onSave={saveEntry}
          onSaved={(saved) =>
            setEntry((current) =>
              current
                ? {
                    ...current,
                    initial: saved,
                    editorKey:
                      current.editorKey ?? current.initial?.id ?? "new",
                  }
                : null,
            )
          }
          position={
            entry.initial && visible.some((a) => a.id === entry.initial!.id)
              ? {
                  index: visible.findIndex((a) => a.id === entry.initial!.id),
                  total: visible.length,
                }
              : undefined
          }
          onStep={
            entry.initial && visible.some((a) => a.id === entry.initial!.id)
              ? (by) => {
                  const i =
                    visible.findIndex((a) => a.id === entry.initial!.id) + by;
                  const a = visible[i];
                  if (a && isCategory(a.category))
                    setEntry({ initial: a, category: a.category });
                }
              : undefined
          }
        />
      )}
      {trashOpen && meeting && (
        <div className="modal-backdrop">
          <section
            className="modal trash-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="삭제한 안건"
          >
            <div className="section-heading">
              <div>
                <h2>삭제한 안건</h2>
                <p>
                  이 회의에서 삭제한 내용만 표시합니다. 이전 회의와 원본 파일은
                  보관됩니다.
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="삭제한 안건 닫기"
                onClick={() => setTrashOpen(false)}
              >
                <X />
              </button>
            </div>
            <div className="trash-list">
              {meeting.agenda
                .filter((a) => a.deletedAt)
                .map((a) => (
                  <article key={a.id}>
                    <div>
                      <strong>{a.title}</strong>
                      <small>
                        {isCategory(a.category)
                          ? categoryLabels[a.category]
                          : a.category}{" "}
                        · 첨부 {a.visuals.length}개
                      </small>
                      <p>{a.report.slice(0, 200)}</p>
                    </div>
                    <button
                      className="secondary"
                      aria-label={`${a.title} 복원`}
                      onClick={() => void restoreEntry(a)}
                    >
                      <RotateCcw size={14} />
                      복원
                    </button>
                  </article>
                ))}
              {!meeting.agenda.some((a) => a.deletedAt) && (
                <div className="empty">삭제한 안건이 없습니다.</div>
              )}
            </div>
          </section>
        </div>
      )}
      {comparisonAgenda &&
        meeting &&
        (() => {
          const a = meeting.agenda.find((a) => a.id === comparisonAgenda);
          const previous = a ? previousAgenda(store.data, a) : undefined;
          return a && previous ? (
            <div className="modal-backdrop">
              <section
                className="modal agenda-change-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="이전 회의 변경 비교"
              >
                <div className="section-heading">
                  <h2>{a.title} · 이전 회의와 비교</h2>
                  <button
                    className="icon-button"
                    aria-label="변경 비교 닫기"
                    onClick={() => setComparisonAgenda(null)}
                  >
                    <X />
                  </button>
                </div>
                <AgendaComparison agenda={a} previous={previous} />
              </section>
            </div>
          ) : null;
        })()}
      {nextSession && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="다음 회의 만들기"
          >
            <div className="section-heading">
              <h2>다음 회의 만들기</h2>
              <button
                className="icon-button"
                aria-label="다음 회의 만들기 닫기"
                disabled={preparing}
                onClick={() => setNextSession(null)}
              >
                <X />
              </button>
            </div>
            <p className="schedule-help">
              회의 날짜를 선택하세요. 요일에 관계없이 이전 진행
              내용·결정·첨부자료를 이어받습니다.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void prepareNext();
              }}
            >
              <label>
                회의 날짜
                <input
                  type="date"
                  required
                  value={nextSession.date}
                  disabled={preparing}
                  onChange={(e) =>
                    setNextSession({ ...nextSession, date: e.target.value })
                  }
                />
              </label>
              <div className="schedule-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={preparing}
                  onClick={() => setNextSession(null)}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={preparing || !nextSession.date}
                >
                  {preparing ? "회의 준비 중…" : "내용 이어서 만들기"}
                </button>
              </div>
            </form>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
      {metadata && meeting && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="회의 정보"
          >
            <div className="section-heading">
              <h2>주간회의 정보</h2>
              <button
                className="icon-button"
                aria-label="회의 정보 닫기"
                onClick={() => setMetadata(false)}
              >
                <X />
              </button>
            </div>
            <label>
              회의 제목
              <input
                value={meeting.title}
                maxLength={200}
                onChange={(e) =>
                  mutateMeeting(meeting.id, (m) => ({
                    ...m,
                    title: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              회의 날짜
              <input
                type="date"
                value={meeting.date}
                onChange={(e) =>
                  mutateMeeting(meeting.id, (m) => ({
                    ...m,
                    date: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              부서명
              <input
                value={meeting.department}
                onChange={(e) =>
                  mutateMeeting(meeting.id, (m) => ({
                    ...m,
                    department: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              참석자
              <input
                placeholder="필요한 경우 입력하세요."
                value={meeting.attendees}
                onChange={(e) =>
                  mutateMeeting(meeting.id, (m) => ({
                    ...m,
                    attendees: e.target.value,
                  }))
                }
              />
            </label>
            <button
              className="primary full"
              disabled={saving > 0 || !meeting.date || !meeting.title.trim()}
              onClick={async () => {
                try {
                  await persist();
                  setMetadata(false);
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              저장하고 닫기
            </button>
          </section>
        </div>
      )}
      {startDialog && meeting && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="회의 녹음 시작"
          >
            <div className="section-heading">
              <h2>회의 시작 · 자동 녹음</h2>
              <button
                className="icon-button"
                aria-label="시작 취소"
                onClick={() => setStartDialog(false)}
              >
                <X />
              </button>
            </div>
            <p className="record-consent-text">
              시작하면 마이크를 켜고 회의 전체를 녹음합니다. 분류 탭을 이동해도
              계속 녹음하며, 회의 종료 후 원본과 요약 결과를 저장합니다.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                참석자의 녹음 동의를 받았고, AI 연결 시 원본이 OpenAI로 전송되는
                것을 확인했습니다.
              </span>
            </label>
            {!ai && (
              <p className="notice">
                현재 AI가 연결되지 않았습니다. 원본 녹음은 저장되며, 연결 후
                다시 정리할 수 있습니다.
              </p>
            )}
            <button
              className="primary full"
              disabled={!consent || recorder.phase !== "idle"}
              onClick={async () => {
                setError("");
                await recorder.start(meeting.id, crypto.randomUUID());
                setStartDialog(false);
              }}
            >
              <Mic size={16} />
              동의하고 녹음 시작
            </button>
          </section>
        </div>
      )}
      {review && (
        <ReviewDialog
          mode={mode}
          file={review.file}
          onClose={() => setReview(null)}
          onReview={(v) => {
            const a = meeting?.agenda.find((a) => a.id === review.agendaId);
            if (a) {
              patchAgenda(a.id, {
                visuals: a.visuals.map((x) => (x.id === v.id ? v : x)),
              });
              void manualSave();
            }
          }}
        />
      )}
      {compare && compareFiles.length === 2 && (
        <CompareDialog
          mode={mode}
          files={compareFiles}
          onClose={() => setCompare(false)}
        />
      )}
      <input
        type="file"
        ref={restoreRef}
        hidden
        accept=".zip"
        aria-label="백업 파일 선택"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (
            !file ||
            !window.confirm(
              "현재 회의 목록을 백업 내용으로 교체할까요? 먼저 현재 자료를 백업해 주세요.",
            )
          )
            return;
          try {
            const b = await restoreBackup(mode, file);
            update(() => b);
            setMeetingId(b.meetings[0]?.id || "");
            await persist();
          } catch (e) {
            setError(message(e));
          }
        }}
      />
      <input
        type="file"
        ref={fileRef}
        hidden
        accept=".pptx"
        aria-label="PPT 파일 선택"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setImportBusy(true);
          try {
            const result = await readPresentation(file);
            setSlides(result);
            setImportIds(result.map((s) => s.number));
            setImportDate(presentationDate(result) || newMeeting().date);
          } catch (e) {
            setError(message(e));
          } finally {
            setImportBusy(false);
          }
        }}
      />
      {slides && (
        <div className="modal-backdrop">
          <section
            className="modal ppt-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="PPT 가져오기 미리보기"
          >
            <div className="section-heading">
              <h2>가져올 페이지 선택</h2>
              <button
                className="icon-button"
                disabled={importBusy}
                aria-label="가져오기 취소"
                onClick={() => setSlides(null)}
              >
                <X />
              </button>
            </div>
            <div className="import-note">
              PPT의 원문과 지원 이미지를 가져옵니다. 가져온 안건의 분류를 확인해
              주세요.
            </div>
            <div className="import-destination">
              <label>
                회의 날짜
                <input
                  type="date"
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                />
              </label>
            </div>
            <div className="import-slides">
              {slides.map((s) => (
                <label className="import-slide" key={s.number}>
                  <input
                    type="checkbox"
                    checked={importIds.includes(s.number)}
                    onChange={(e) =>
                      setImportIds((ids) =>
                        e.target.checked
                          ? [...ids, s.number]
                          : ids.filter((x) => x !== s.number),
                      )
                    }
                  />
                  <span>
                    <small>
                      {s.number}페이지 · 이미지 {s.files.length}개
                    </small>
                    <strong>{s.agenda.title}</strong>
                    <p>{s.agenda.report.slice(0, 150)}</p>
                    {s.agenda.plan && <em>업무 계획 별도 추출됨</em>}
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-action-row">
              <button
                className="primary"
                disabled={importBusy || !importIds.length || !importDate}
                onClick={async () => {
                  setImportBusy(true);
                  try {
                    const agenda = await materializeSlides(
                      mode,
                      slides.filter((s) => importIds.includes(s.number)),
                    );
                    const m = { ...newMeeting(importDate), agenda };
                    update((b) => insertMeeting(b, m));
                    setMeetingId(m.id);
                    setTab("development");
                    await persist();
                    setSlides(null);
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    setImportBusy(false);
                  }
                }}
              >
                {importBusy
                  ? "가져오는 중…"
                  : `${importIds.length}개 페이지 가져오기`}
              </button>
            </div>
          </section>
        </div>
      )}
      {history && (
        <div className="modal-backdrop">
          <section
            className="modal ppt-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="수정 이력"
          >
            <div className="section-heading">
              <h2>최근 저장 이력</h2>
              <button
                className="icon-button"
                aria-label="이력 닫기"
                onClick={() => {
                  setHistory(null);
                  setOldVersion(null);
                }}
              >
                <X />
              </button>
            </div>
            <div className="history-content">
              {history.map((h) => (
                <button
                  className="history-link"
                  key={h.version}
                  onClick={() => setOldVersion(h)}
                >
                  <strong>버전 {h.version}</strong>
                  <span>
                    {new Date(h.created_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </span>
                </button>
              ))}
              {oldVersion && (
                <div className="historical-content">
                  {oldVersion.data.meetings.map((m) => (
                    <section key={m.id}>
                      <h3>
                        {m.date} · {m.title}
                      </h3>
                      {m.agenda.map((a) => (
                        <article key={a.id}>
                          <h4>{a.title}</h4>
                          <p>{a.report}</p>
                          <p>{a.plan}</p>
                          <p>{a.decision}</p>
                        </article>
                      ))}
                      {m.recordings?.map((r) => (
                        <div key={r.id}>
                          <h4>녹음 요약</h4>
                          {r.draft?.summary.map((s, i) => (
                            <p key={i}>{s.text}</p>
                          ))}
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
              {!history.length && (
                <p className="empty">저장 이력이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "처리에 실패했습니다.";
}
function clock(value: number) {
  return [Math.floor(value / 3600), Math.floor((value % 3600) / 60), value % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
