"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cloud,
  FileText,
  FolderKanban,
  History,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Link,
  Maximize2,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Plus,
  Presentation as PresentationIcon,
  Printer,
  Save,
  Search,
  Sparkles,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  addTask,
  boardSchema,
  categoryLabels,
  carryMeeting,
  emptyBoard,
  fileMimes,
  newAgenda,
  insertMeeting,
  newMeeting,
  reviewLabels,
  type Agenda,
  type Board,
  type Session,
  type Snapshot,
  type StoredBoard,
  type Visual,
  type WorkTask,
} from "@/lib/conference";
import {
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
  readPresentation,
  presentationDate,
  restoreBackup,
  type ImportedSlide,
} from "@/lib/conference-import";
import { nextMonday } from "@/lib/types";
import {
  AssetImage,
  CompareDialog,
  downloadAsset,
  downloadBlob,
  Presentation,
  ReviewDialog,
} from "./conference-assets";
import ConferenceAI from "./conference-ai";
const taskLabels = { todo: "진행 전", doing: "진행 중", done: "완료" };
type Tab = "meeting" | "design" | "tasks" | "archive";
export default function ConferenceBoard() {
  const [storage, setStorage] = useState<StorageMode>("local");
  const [ready, setReady] = useState(false);
  const [accessible, setAccessible] = useState(true);
  const [aiEnabled, setAIEnabled] = useState(false);
  const [state, setState] = useState<StoredBoard>({
    version: 0,
    data: emptyBoard(),
  });
  const latest = useRef(state);
  latest.current = state;
  const baseline = useRef<Board>(emptyBoard());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("meeting");
  const [meetingId, setMeetingId] = useState("");
  const [agendaId, setAgendaId] = useState("");
  const [myName, setMyName] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [review, setReview] = useState<{
    agendaId: string;
    file: Visual;
  } | null>(null);
  const [comparison, setComparison] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [presenting, setPresenting] = useState(false);
  const [aiOpen, setAIOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [imported, setImported] = useState<ImportedSlide[] | null>(null);
  const [importSelection, setImportSelection] = useState<number[]>([]);
  const [importAsNew, setImportAsNew] = useState(true);
  const [importDate, setImportDate] = useState(nextMonday());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState<number | null>(null);
  const [fileKind, setFileKind] = useState<"image" | "all">("image");
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<() => void>(() => {});
  const meeting =
    state.data.meetings.find((m) => m.id === meetingId) ||
    state.data.meetings[0];
  const agenda =
    meeting?.agenda.find((a) => a.id === agendaId) || meeting?.agenda[0];
  const meetingTasks = state.data.tasks.filter(
    (t) => meeting && t.meetingIds.includes(meeting.id),
  );
  const allVisuals =
    meeting?.agenda.flatMap((a) =>
      a.visuals
        .filter((v) => v.mime.startsWith("image/"))
        .map((v) => ({ agenda: a, file: v })),
    ) || [];
  const pending = allVisuals.filter((v) => v.file.status !== "approved");
  const shownAgenda =
    meeting?.agenda.filter(
      (a) =>
        (!onlyMine || (!!myName && a.owner === myName)) &&
        (!category || a.category === category) &&
        `${a.title} ${a.product} ${a.owner} ${a.partner} ${a.report}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const d = await detectMode();
        if (!mounted) return;
        setStorage(d.mode);
        setAccessible(d.accessible);
        setAIEnabled(d.ai);
        if (!d.accessible) return;
        const loaded = await loadBoard(d.mode);
        boardSchema.parse(loaded.data);
        if (!mounted) return;
        setState(loaded);
        baseline.current = loaded.data;
        setMeetingId(loaded.data.meetings[0]?.id || "");
        setMyName(localStorage.getItem("azla-display-name") || "");
      } catch (e) {
        if (mounted)
          setError(
            e instanceof Error ? e.message : "워크스페이스를 열지 못했습니다.",
          );
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
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
  }, [dirty]);
  function update(fn: (b: Board) => Board) {
    setState((s) => ({ ...s, data: fn(s.data) }));
    setDirty(true);
    setStatus("");
  }
  function patchMeeting(patch: Partial<Session>) {
    if (!meeting) return;
    update((b) => ({
      ...b,
      meetings: b.meetings.map((m) =>
        m.id === meeting.id
          ? {
              ...m,
              ...patch,
              status: patch.status ?? "draft",
              reviewed: patch.reviewed ?? false,
            }
          : m,
      ),
    }));
  }
  function patchAgenda(patch: Partial<Agenda>, id = agenda?.id) {
    if (!meeting || !id) return;
    update((b) => ({
      ...b,
      meetings: b.meetings.map((m) =>
        m.id === meeting.id
          ? {
              ...m,
              status: "draft",
              reviewed: false,
              agenda: m.agenda.map((a) =>
                a.id === id ? { ...a, ...patch } : a,
              ),
            }
          : m,
      ),
    }));
  }
  async function persist(data = state.data) {
    if (busy) return;
    setBusy(true);
    setError("");
    const sent = data;
    try {
      const result = await saveWithMerge(
        storage,
        { version: state.version, data: sent },
        baseline.current,
      );
      baseline.current = result.data;
      const currentData = latest.current.data;
      const changedDuringSave =
        currentData !== state.data && currentData !== sent;
      setState({
        version: result.version,
        data: changedDuringSave
          ? mergeBoards(sent, currentData, result.data)
          : result.data,
      });
      setDirty(changedDuringSave);
      setStatus("회의 내용을 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  saveRef.current = () => void persist();
  async function create() {
    const m = newMeeting();
    m.agenda = [newAgenda("신제품 개발")];
    const data = insertMeeting(state.data, m);
    update(() => data);
    setMeetingId(m.id);
    setAgendaId(m.agenda[0].id);
    setTab("meeting");
    setMetaOpen(true);
  }
  async function addFiles(files: File[]) {
    if (!meeting || !agenda) throw new Error("안건을 먼저 선택해 주세요.");
    const mid = meeting.id,
      aid = agenda.id;
    for (const file of files) {
      const mime = file.type.split(";")[0];
      if (!fileMimes.includes(mime))
        throw new Error(
          "JPG, PNG, WebP, PDF 또는 지원하는 녹음파일을 선택해 주세요.",
        );
      if (!file.size || file.size > 20 * 1024 * 1024)
        throw new Error("파일당 최대 20MB까지 첨부할 수 있습니다.");
      const id = crypto.randomUUID();
      const path = await saveFile(storage, id, file, file.name);
      const v: Visual = {
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
      update((b) => ({
        ...b,
        meetings: b.meetings.map((m) =>
          m.id === mid
            ? {
                ...m,
                status: "draft",
                reviewed: false,
                agenda: m.agenda.map((a) =>
                  a.id === aid ? { ...a, visuals: [...a.visuals, v] } : a,
                ),
              }
            : m,
        ),
      }));
    }
    setStatus("자료를 첨부했습니다. 회의 저장을 눌러 연결 내용을 보관하세요.");
  }
  function applyReview(agendaId: string, v: Visual) {
    const a = meeting?.agenda.find((a) => a.id === agendaId);
    if (a)
      patchAgenda(
        { visuals: a.visuals.map((f) => (f.id === v.id ? v : f)) },
        agendaId,
      );
  }
  async function backup() {
    setBusy(true);
    setError("");
    try {
      downloadBlob(
        await exportBackup(storage, state.data),
        `AZLA-회의백업-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      setStatus("사진과 검토 기록이 포함된 백업 파일을 내보냈습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "백업에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory() {
    try {
      setHistory(await revisions(storage));
      setHistoryOpen(true);
      setHistoryVersion(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "수정 이력을 불러오지 못했습니다.",
      );
    }
  }
  async function reload() {
    if (
      dirty &&
      !window.confirm(
        "최신 자료를 불러오면 저장하지 않은 수정이 사라집니다. 먼저 백업을 내보내 주세요. 계속할까요?",
      )
    )
      return;
    setBusy(true);
    try {
      const loaded = await loadBoard(storage);
      setState(loaded);
      baseline.current = loaded.data;
      setDirty(false);
      setError("");
      setStatus("최신 회의 내용을 불러왔습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setBusy(false);
    }
  }
  const comparisonFiles = allVisuals
    .filter((v) => compareIds.includes(v.file.id))
    .map((v) => v.file);
  const people = [
    ...new Set(
      state.data.meetings
        .flatMap((m) => m.agenda.map((a) => a.owner))
        .filter(Boolean),
    ),
  ];
  return (
    <div className="shell conference-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          AZLA
          <span>
            MEETING
            <br />
            WORKSPACE
          </span>
        </a>
        <div className="workspace-tag">
          <span className="green-dot" />
          음향기술연구소 <Users size={14} />
        </div>
        <div className="nav-label">WEEKLY CONFERENCE</div>
        <nav>
          {[
            {
              id: "meeting" as const,
              label: "회의 진행",
              icon: LayoutDashboard,
            },
            { id: "design" as const, label: "디자인 컨펌", icon: ImageIcon },
            { id: "tasks" as const, label: "후속 업무", icon: ClipboardList },
            { id: "archive" as const, label: "지난 회의", icon: FolderKanban },
          ].map((n) => (
            <button
              className={`nav-item ${tab === n.id ? "active" : ""}`}
              key={n.id}
              onClick={() => {
                setTab(n.id);
                setSearch("");
              }}
              aria-label={n.label}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "design" && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Layers size={22} />
          <strong>
            함께 보고, 결정하고.
            <br />
            다음 주로 이어갑니다.
          </strong>
          <p>
            업무 보고부터 디자인 검토까지
            <br />
            우리 팀의 회의를 한곳에서.
          </p>
        </div>
        <div className="name-entry">
          <UserRound size={18} />
          <div>
            <label htmlFor="display-name">내 이름 · 담당 안건 필터</label>
            <input
              id="display-name"
              placeholder="이름 입력"
              maxLength={80}
              value={myName}
              onChange={(e) => {
                setMyName(e.target.value);
                localStorage.setItem("azla-display-name", e.target.value);
              }}
            />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={13} />
            <strong>
              {
                {
                  meeting: "회의 진행",
                  design: "디자인 컨펌",
                  tasks: "후속 업무",
                  archive: "지난 회의",
                }[tab]
              }
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`storage-badge ${storage}`}>
              <Cloud size={14} />
              {!ready
                ? "연결 확인 중"
                : storage === "shared"
                  ? "팀 공유 저장소"
                  : "이 브라우저에 저장"}
            </span>
            <button
              className="text-button"
              disabled={busy || !ready || !accessible}
              onClick={() => void backup()}
            >
              <ArrowDownToLine size={14} /> 전체 백업
            </button>
          </div>
        </header>
        <main className="content conference-content">
          {!ready ? (
            <div className="empty">회의 워크스페이스를 여는 중입니다…</div>
          ) : !accessible ? (
            <section className="welcome-card">
              <div className="eyebrow">TEAM WORKSPACE</div>
              <h1>팀 공유 링크로 들어와 주세요.</h1>
              <p>
                계정 로그인 없이, 전달받은 링크로 같은 회의록을 함께 작성합니다.
              </p>
              <p className="muted">
                링크를 관리하는 담당자에게 공유 링크를 요청해 주세요.
              </p>
            </section>
          ) : (
            <>
              {storage === "local" && (
                <div className="local-banner">
                  <Monitor size={16} />
                  <span>
                    지금은 <strong>이 브라우저에만 저장</strong>됩니다.
                    담당자들이 함께 작성하려면 Supabase 팀 공유를 연결해 주세요.
                  </span>
                  <button
                    className="text-button"
                    onClick={() => restoreRef.current?.click()}
                  >
                    백업 가져오기
                  </button>
                </div>
              )}
              <div className="conference-page-heading">
                <div>
                  <span className="eyebrow">AZLA WEEKLY CONFERENCE</span>
                  <h1>
                    {
                      {
                        meeting: "보고에서 결정까지, 한 흐름으로.",
                        design: "시안을 함께 보고, 방향을 결정하세요.",
                        tasks: "지난 회의의 약속을 이어갑니다.",
                        archive: "매주의 결정이 쌓이는 곳.",
                      }[tab]
                    }
                  </h1>
                  <p>
                    {
                      {
                        meeting:
                          "제품별 진행 상황과 다음 계획을 확인하고, 필요한 결정을 바로 기록하세요.",
                        design:
                          "제품 외관·색상·패키지 시안을 비교하고 대표님 검토 의견을 남기세요.",
                        tasks:
                          "담당자와 기한을 확인하고, 완료되지 않은 업무를 다음 회의로 연결하세요.",
                        archive:
                          "회의 날짜와 제품, 논의한 내용을 검색해 보세요.",
                      }[tab]
                    }
                  </p>
                </div>
                <div className="heading-buttons">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={16} /> PPT 가져오기
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void create()}
                  >
                    <Plus size={17} /> 새 주간회의
                  </button>
                </div>
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              {status && (
                <div className="save-message" role="status">
                  <Check size={15} />
                  {status}
                </div>
              )}
              {!meeting ? (
                <section className="welcome-card">
                  <div className="welcome-art">
                    <Layers size={44} />
                  </div>
                  <span className="eyebrow">A BETTER WAY TO MEET</span>
                  <h2>우리 팀의 회의자료부터 가져와 보세요.</h2>
                  <p>
                    PPT의 업무 보고·업무 계획과 이미지를 안건으로 가져옵니다.
                    <br />
                    로그인 없이 내용을 작성하고, 시안별 검토 의견을 남길 수
                    있습니다.
                  </p>
                  <button
                    className="primary"
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={17} /> 기존 PPT로 회의 시작
                  </button>
                  <button className="text-button" onClick={() => void create()}>
                    빈 회의록으로 시작 <ArrowRight size={15} />
                  </button>
                </section>
              ) : (
                <>
                  <section className="session-toolbar">
                    <div className="session-picker">
                      <CalendarDays size={19} />
                      <select
                        aria-label="회의 선택"
                        value={meeting.id}
                        onChange={(e) => {
                          setMeetingId(e.target.value);
                          setAgendaId("");
                          setCompareIds([]);
                        }}
                      >
                        {state.data.meetings.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.date} · {m.title}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`badge ${meeting.status === "final" ? "green" : "orange"}`}
                      >
                        {meeting.status === "final" ? "확정" : "작성 중"}
                      </span>
                      <button
                        className="icon-button"
                        aria-label="회의 정보 수정"
                        onClick={() => setMetaOpen(true)}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                    <div className="session-actions">
                      <span className={`save-state ${dirty ? "unsaved" : ""}`}>
                        {dirty
                          ? "저장하지 않은 변경"
                          : `저장 버전 ${state.version}`}
                      </span>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void reload()}
                      >
                        최신 불러오기
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void persist()}
                      >
                        <Save size={16} />
                        {busy ? "처리 중…" : "회의 저장"}
                      </button>
                    </div>
                  </section>
                  {tab === "meeting" && (
                    <>
                      <div className="meeting-summary-strip">
                        <div>
                          <span>오늘의 안건</span>
                          <strong>
                            {meeting.agenda.length}
                            <small>건</small>
                          </strong>
                        </div>
                        <div>
                          <span>검토할 시안</span>
                          <strong>
                            {pending.length}
                            <small>건</small>
                          </strong>
                        </div>
                        <div>
                          <span>미완료 후속 업무</span>
                          <strong>
                            {
                              meetingTasks.filter((t) => t.status !== "done")
                                .length
                            }
                            <small>건</small>
                          </strong>
                        </div>
                        <button
                          className="meeting-mode-button"
                          disabled={!meeting.agenda.length}
                          onClick={() => setPresenting(true)}
                        >
                          <PresentationIcon size={22} />
                          <span>
                            <strong>회의 모드로 보기</strong>
                            <small>큰 화면으로 안건과 시안을 차례로</small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      </div>
                      <div className="conference-workbench">
                        <aside className="agenda-panel">
                          <div className="agenda-panel-heading">
                            <h2>회의 안건</h2>
                            <button
                              className="icon-button"
                              aria-label="안건 추가"
                              onClick={() => {
                                const a = newAgenda();
                                patchMeeting({
                                  agenda: [...meeting.agenda, a],
                                });
                                setAgendaId(a.id);
                              }}
                            >
                              <Plus size={19} />
                            </button>
                          </div>
                          <label className="search-box">
                            <Search size={15} />
                            <input
                              aria-label="안건 검색"
                              placeholder="제품, 담당자 검색"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </label>
                          <label className="mobile-name">
                            내 이름
                            <input
                              placeholder="담당자 이름"
                              value={myName}
                              onChange={(e) => {
                                setMyName(e.target.value);
                                localStorage.setItem(
                                  "azla-display-name",
                                  e.target.value,
                                );
                              }}
                            />
                          </label>
                          <div className="agenda-controls">
                            <select
                              aria-label="안건 분류"
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                            >
                              <option value="">모든 분류</option>
                              {Object.entries(categoryLabels).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                            <label className="mine-toggle">
                              <input
                                type="checkbox"
                                checked={onlyMine}
                                onChange={(e) => setOnlyMine(e.target.checked)}
                              />
                              내 담당
                            </label>
                          </div>
                          <div className="agenda-list">
                            {shownAgenda.map((a, i) => (
                              <button
                                key={a.id}
                                className={`agenda-nav ${agenda?.id === a.id ? "selected" : ""}`}
                                onClick={() => setAgendaId(a.id)}
                              >
                                <span className="agenda-number">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span>
                                  <strong>{a.title}</strong>
                                  <small>
                                    {a.owner || "담당자 미지정"} ·{" "}
                                    {a.partner || categoryLabels[a.category]}
                                  </small>
                                  {a.visuals.some((v) =>
                                    v.mime.startsWith("image/"),
                                  ) && (
                                    <em>
                                      <ImageIcon size={11} />
                                      {
                                        a.visuals.filter((v) =>
                                          v.mime.startsWith("image/"),
                                        ).length
                                      }
                                      개 시안
                                    </em>
                                  )}
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                            {shownAgenda.length === 0 && (
                              <div className="empty">
                                {onlyMine && !myName
                                  ? "왼쪽 아래에 내 이름을 입력해 주세요."
                                  : "조건에 맞는 안건이 없습니다."}
                              </div>
                            )}
                          </div>
                          <button
                            className="add-agenda"
                            onClick={() => {
                              const a = newAgenda();
                              patchMeeting({ agenda: [...meeting.agenda, a] });
                              setAgendaId(a.id);
                            }}
                          >
                            <Plus size={15} /> 새 안건 추가
                          </button>
                        </aside>
                        {agenda ? (
                          <section className="agenda-editor">
                            <div className="agenda-title-row">
                              <div>
                                <span className="eyebrow">
                                  {categoryLabels[agenda.category]}
                                </span>
                                <input
                                  className="agenda-title-input"
                                  aria-label="안건 제목"
                                  value={agenda.title}
                                  maxLength={500}
                                  onChange={(e) =>
                                    patchAgenda({ title: e.target.value })
                                  }
                                />
                              </div>
                              <button
                                className="secondary"
                                onClick={() => setAIOpen(true)}
                              >
                                <Sparkles size={15} /> 녹음 · AI 정리
                              </button>
                            </div>
                            <div className="agenda-meta">
                              <label>
                                제품명
                                <input
                                  aria-label="제품명"
                                  placeholder="제품 / 프로젝트"
                                  value={agenda.product}
                                  maxLength={500}
                                  onChange={(e) =>
                                    patchAgenda({ product: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                담당자
                                <input
                                  aria-label="안건 담당자"
                                  placeholder="작성 담당자"
                                  value={agenda.owner}
                                  list="team-names"
                                  maxLength={80}
                                  onChange={(e) =>
                                    patchAgenda({ owner: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                협력업체
                                <input
                                  placeholder="업체명"
                                  value={agenda.partner}
                                  maxLength={200}
                                  onChange={(e) =>
                                    patchAgenda({ partner: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                분류
                                <select
                                  aria-label="안건 유형"
                                  value={agenda.category}
                                  onChange={(e) =>
                                    patchAgenda({
                                      category: e.target
                                        .value as Agenda["category"],
                                    })
                                  }
                                >
                                  {Object.entries(categoryLabels).map(
                                    ([k, v]) => (
                                      <option key={k} value={k}>
                                        {v}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </label>
                            </div>
                            <datalist id="team-names">
                              {people.map((p) => (
                                <option key={p}>{p}</option>
                              ))}
                            </datalist>
                            {agenda.source && (
                              <p className="source-note">
                                <FileText size={12} />
                                {agenda.source}
                              </p>
                            )}
                            {agenda.previous && (
                              <details className="previous-report">
                                <summary>
                                  <History size={14} /> 지난 회의 보고 내용
                                </summary>
                                <p>{agenda.previous}</p>
                              </details>
                            )}
                            <div className="report-plan-grid">
                              <label>
                                <span className="field-heading">
                                  <i>01</i>이번 주 업무 보고
                                </span>
                                <textarea
                                  aria-label="이번 주 업무 보고"
                                  rows={11}
                                  maxLength={60000}
                                  placeholder="진행 상황, 샘플 검토 결과, 확인한 이슈를 작성하세요."
                                  value={agenda.report}
                                  onChange={(e) =>
                                    patchAgenda({ report: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                <span className="field-heading">
                                  <i>02</i>다음 계획
                                </span>
                                <textarea
                                  aria-label="다음 계획"
                                  rows={11}
                                  maxLength={30000}
                                  placeholder="다음 주 계획, 확인할 내용과 일정을 작성하세요."
                                  value={agenda.plan}
                                  onChange={(e) =>
                                    patchAgenda({ plan: e.target.value })
                                  }
                                />
                              </label>
                            </div>
                            <section className="decision-field">
                              <label>
                                <span className="field-heading">
                                  <MessageSquare size={15} />
                                  회의 결정 · 대표님 확인 사항
                                </span>
                                <textarea
                                  aria-label="회의 결정"
                                  rows={3}
                                  maxLength={30000}
                                  placeholder="회의 중 결정된 방향과 추가 확인이 필요한 내용을 기록하세요."
                                  value={agenda.decision}
                                  onChange={(e) =>
                                    patchAgenda({ decision: e.target.value })
                                  }
                                />
                              </label>
                            </section>
                            <div className="visual-section-heading">
                              <div>
                                <h3>
                                  디자인 시안 · 검토 자료{" "}
                                  <span className="tiny-count">
                                    {
                                      agenda.visuals.filter((v) =>
                                        v.mime.startsWith("image/"),
                                      ).length
                                    }
                                  </span>
                                </h3>
                                <p>
                                  이미지를 눌러 크게 보고, 승인 또는 수정 요청을
                                  남기세요.
                                </p>
                              </div>
                              <div className="visual-heading-actions">
                                {comparisonFiles.length > 0 && (
                                  <button
                                    className="secondary"
                                    disabled={comparisonFiles.length !== 2}
                                    onClick={() => setComparison(true)}
                                  >
                                    <Layers size={14} /> 비교 (
                                    {comparisonFiles.length}/2)
                                  </button>
                                )}
                                <button
                                  className="secondary"
                                  disabled={busy}
                                  onClick={() => {
                                    setFileKind("image");
                                    uploadRef.current?.click();
                                  }}
                                >
                                  <Plus size={15} /> 시안 추가
                                </button>
                              </div>
                            </div>
                            <div className="visual-grid">
                              {agenda.visuals
                                .filter((v) => v.mime.startsWith("image/"))
                                .map((v) => visualCard(agenda, v))}
                            </div>
                            {!agenda.visuals.some((v) =>
                              v.mime.startsWith("image/"),
                            ) && (
                              <button
                                className="image-dropzone"
                                onClick={() => {
                                  setFileKind("image");
                                  uploadRef.current?.click();
                                }}
                              >
                                <ImageIcon size={27} />
                                <strong>
                                  대표님과 함께 볼 시안을 추가하세요.
                                </strong>
                                <span>
                                  제품 외관 · 색상 · 로고 · 패키지 · 측정 그래프
                                </span>
                              </button>
                            )}
                            <div className="attachments-row">
                              {agenda.visuals
                                .filter((v) => !v.mime.startsWith("image/"))
                                .map((v) => (
                                  <button
                                    className="attachment-link"
                                    key={v.id}
                                    onClick={() =>
                                      void downloadAsset(storage, v).catch(
                                        (e) => setError(e.message),
                                      )
                                    }
                                  >
                                    <FileText size={15} />
                                    {v.name}
                                    <ArrowDownToLine size={13} />
                                  </button>
                                ))}
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setFileKind("all");
                                  uploadRef.current?.click();
                                }}
                              >
                                <Plus size={14} /> PDF · 기타 자료 첨부
                              </button>
                            </div>
                            <div className="agenda-footer">
                              <button
                                className="text-button"
                                onClick={() => setTaskOpen(true)}
                              >
                                <Plus size={15} /> 이 안건의 후속 업무 등록
                              </button>
                              <span>
                                변경 후 상단 ‘회의 저장’을 눌러 주세요.
                              </span>
                            </div>
                          </section>
                        ) : (
                          <section className="agenda-editor empty">
                            <h3>회의 안건을 추가하세요.</h3>
                            <p>
                              PPT를 가져오거나 왼쪽 + 버튼으로 작성할 수
                              있습니다.
                            </p>
                          </section>
                        )}
                      </div>
                    </>
                  )}
                  {tab === "design" && (
                    <>
                      <div className="design-filters">
                        <div className="filter-pills">
                          {[
                            ["all", "전체 시안"],
                            ["pending", "검토 대기"],
                            ["changes", "수정 요청"],
                            ["approved", "승인 완료"],
                          ].map(([key, label]) => (
                            <button
                              className={reviewFilter === key ? "active" : ""}
                              key={key}
                              onClick={() => setReviewFilter(key)}
                            >
                              {label}{" "}
                              <span>
                                {key === "all"
                                  ? allVisuals.length
                                  : allVisuals.filter(
                                      (x) => x.file.status === key,
                                    ).length}
                              </span>
                            </button>
                          ))}
                        </div>
                        <button
                          className="secondary"
                          disabled={comparisonFiles.length !== 2}
                          onClick={() => setComparison(true)}
                        >
                          <Layers size={16} /> 선택한 시안 비교 (
                          {comparisonFiles.length}/2)
                        </button>
                      </div>
                      <div className="visual-grid design-board">
                        {allVisuals
                          .filter(
                            (v) =>
                              reviewFilter === "all" ||
                              v.file.status === reviewFilter,
                          )
                          .map(({ agenda: a, file: v }) =>
                            visualCard(a, v, true),
                          )}
                      </div>
                      {allVisuals.length === 0 && (
                        <div className="panel empty">
                          <ImageIcon size={34} />
                          <h3>검토할 디자인 시안이 없습니다.</h3>
                          <p>
                            회의 진행 화면의 각 안건에 이미지를 추가해 주세요.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {tab === "tasks" && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>이번 회의 후속 업무</h2>
                          <p className="muted">
                            이월 업무는 원래 업무와 같은 기록으로 관리합니다.
                          </p>
                        </div>
                        <button
                          className="primary"
                          onClick={() => setTaskOpen(true)}
                        >
                          <Plus size={16} /> 업무 등록
                        </button>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>업무 내용</th>
                              <th>제품 / 안건</th>
                              <th>담당자</th>
                              <th>완료 예정일</th>
                              <th>진행 상태</th>
                            </tr>
                          </thead>
                          <tbody>
                            {meetingTasks.map((t) => (
                              <tr key={t.id}>
                                <td>
                                  {t.title}
                                  {t.meetingIds.length > 1 && (
                                    <span className="badge orange carry-badge">
                                      이월
                                    </span>
                                  )}
                                </td>
                                <td>{t.product || "공통"}</td>
                                <td>
                                  <input
                                    aria-label={`${t.title} 담당자`}
                                    value={t.owner}
                                    placeholder="미지정"
                                    onChange={(e) =>
                                      update((b) => ({
                                        ...b,
                                        tasks: b.tasks.map((x) =>
                                          x.id === t.id
                                            ? { ...x, owner: e.target.value }
                                            : x,
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`${t.title} 완료 예정일`}
                                    type="date"
                                    value={t.due}
                                    onChange={(e) =>
                                      update((b) => ({
                                        ...b,
                                        tasks: b.tasks.map((x) =>
                                          x.id === t.id
                                            ? { ...x, due: e.target.value }
                                            : x,
                                        ),
                                      }))
                                    }
                                  />
                                </td>
                                <td>
                                  <select
                                    aria-label={`${t.title} 상태`}
                                    value={t.status}
                                    onChange={(e) =>
                                      update((b) => ({
                                        ...b,
                                        tasks: b.tasks.map((x) =>
                                          x.id === t.id
                                            ? {
                                                ...x,
                                                status: e.target
                                                  .value as WorkTask["status"],
                                              }
                                            : x,
                                        ),
                                      }))
                                    }
                                  >
                                    {Object.entries(taskLabels).map(
                                      ([k, v]) => (
                                        <option key={k} value={k}>
                                          {v}
                                        </option>
                                      ),
                                    )}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!meetingTasks.length && (
                        <div className="empty">
                          후속 업무를 등록하고 담당자·예정일을 지정해 주세요.
                        </div>
                      )}
                    </section>
                  )}
                  {tab === "archive" && (
                    <>
                      <div className="filters">
                        <label className="search-box">
                          <Search size={16} />
                          <input
                            aria-label="지난 회의 검색"
                            placeholder="회의 제목, 날짜, 제품, 논의 내용 검색"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <button
                          className="secondary"
                          onClick={() => void loadHistory()}
                        >
                          <History size={16} /> 수정 이력
                        </button>
                      </div>
                      <section className="panel">
                        {state.data.meetings
                          .filter((m) =>
                            [
                              m.title,
                              m.date,
                              ...m.agenda.flatMap((a) => [
                                a.title,
                                a.product,
                                a.report,
                                a.plan,
                                a.decision,
                              ]),
                            ]
                              .join(" ")
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .map((m) => (
                            <button
                              className="meeting-row"
                              key={m.id}
                              onClick={() => {
                                setMeetingId(m.id);
                                setAgendaId("");
                                setTab("meeting");
                              }}
                            >
                              <div className="date-tile">
                                <small>{m.date.slice(5, 7)}월</small>
                                <strong>{m.date.slice(8)}</strong>
                              </div>
                              <div className="meeting-info">
                                <div>
                                  <h3>{m.title}</h3>
                                  <span
                                    className={`badge ${m.status === "final" ? "green" : "orange"}`}
                                  >
                                    {m.status === "final" ? "확정" : "작성 중"}
                                  </span>
                                </div>
                                <p>
                                  {m.department} · 안건 {m.agenda.length}건 ·{" "}
                                  {m.attendees || "참석자 미입력"}
                                </p>
                                <small>{m.date}</small>
                              </div>
                              <ChevronRight size={18} />
                            </button>
                          ))}
                      </section>
                    </>
                  )}
                  <div className="conference-bottom-actions">
                    <div>
                      <button
                        className="text-button"
                        onClick={() => void loadHistory()}
                      >
                        <History size={14} />
                        수정 이력
                      </button>
                      <button
                        className="text-button"
                        onClick={() => window.print()}
                      >
                        <Printer size={14} /> 인쇄 / PDF
                      </button>
                      <button
                        className="text-button"
                        onClick={() => restoreRef.current?.click()}
                      >
                        <Upload size={14} /> 백업 복원
                      </button>
                    </div>
                    <button
                      className="secondary"
                      onClick={() => {
                        const d = new Date(`${meeting.date}T12:00:00`);
                        d.setDate(d.getDate() + 7);
                        const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                        const data = carryMeeting(state.data, meeting, next);
                        update(() => data);
                        setMeetingId(data.meetings[0].id);
                        setAgendaId("");
                        setTab("meeting");
                        setStatus(
                          "지난 보고와 미완료 업무를 새 회의에 연결했습니다. 날짜 확인 후 저장해 주세요.",
                        );
                      }}
                    >
                      <CalendarDays size={15} /> 다음 주 회의 준비
                    </button>
                  </div>
                  <section className="conference-print">
                    <h1>{meeting.title}</h1>
                    <p>
                      {meeting.date} · {meeting.department} ·{" "}
                      {meeting.attendees}
                    </p>
                    {meeting.agenda.map((a) => (
                      <article key={a.id}>
                        <h2>{a.product || a.title}</h2>
                        <p>
                          담당자: {a.owner || "미지정"} · 협력업체:{" "}
                          {a.partner || "없음"}
                        </p>
                        <h3>업무 보고</h3>
                        <p>{a.report}</p>
                        <h3>다음 계획</h3>
                        <p>{a.plan}</p>
                        <h3>결정 사항</h3>
                        <p>{a.decision}</p>
                        {a.visuals
                          .filter((v) => v.mime.startsWith("image/"))
                          .map((v) => (
                            <div className="print-visual" key={v.id}>
                              <AssetImage mode={storage} file={v} />
                              <p>
                                {v.label} · {reviewLabels[v.status]} ·{" "}
                                {v.reviewer}
                                <br />
                                {v.comment}
                              </p>
                            </div>
                          ))}
                      </article>
                    ))}
                    <h2>후속 업무</h2>
                    {meetingTasks.map((t) => (
                      <p key={t.id}>
                        {t.title} · {t.owner || "미지정"} ·{" "}
                        {t.due || "기한 미정"} · {taskLabels[t.status]}
                      </p>
                    ))}
                  </section>
                </>
              )}
              <footer>
                © {new Date().getFullYear()} AZLA{" "}
                <span>Weekly Conference · 함께 만드는 다음</span>
              </footer>
            </>
          )}
        </main>
      </div>
      <input
        ref={importRef}
        type="file"
        hidden
        accept=".pptx"
        aria-label="PPT 파일 선택"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setError("");
          try {
            const slides = await readPresentation(f);
            setImported(slides);
            setImportDate(presentationDate(slides) || nextMonday());
            setImportAsNew(true);
            setImportSelection(slides.map((s) => s.number));
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "PPT를 가져오지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      <input
        ref={restoreRef}
        type="file"
        hidden
        accept=".zip"
        aria-label="백업 파일 선택"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (
            !window.confirm(
              "현재 회의 목록을 백업 내용으로 교체합니다. 현재 자료를 먼저 백업했나요?",
            )
          )
            return;
          setBusy(true);
          try {
            const restored = await restoreBackup(storage, f);
            update(() => restored);
            setMeetingId(restored.meetings[0]?.id || "");
            setStatus(
              "백업을 불러왔습니다. 내용을 확인하고 회의 저장을 눌러 주세요.",
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : "백업 복원 실패");
          } finally {
            setBusy(false);
          }
        }}
      />
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        accept={
          fileKind === "image"
            ? "image/png,image/jpeg,image/webp"
            : fileMimes.join(",")
        }
        aria-label="시안 이미지 선택"
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          setBusy(true);
          setError("");
          try {
            await addFiles(files);
          } catch (err) {
            setError(err instanceof Error ? err.message : "파일 첨부 실패");
          } finally {
            setBusy(false);
          }
        }}
      />
      {meeting && metaOpen && (
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
                onClick={() => setMetaOpen(false)}
              >
                <X />
              </button>
            </div>
            <label>
              회의 제목
              <input
                value={meeting.title}
                maxLength={200}
                onChange={(e) => patchMeeting({ title: e.target.value })}
              />
            </label>
            <label>
              회의 날짜
              <input
                type="date"
                value={meeting.date}
                onChange={(e) => patchMeeting({ date: e.target.value })}
              />
            </label>
            <label>
              부서명
              <input
                value={meeting.department}
                maxLength={200}
                onChange={(e) => patchMeeting({ department: e.target.value })}
              />
            </label>
            <label>
              참석자
              <input
                placeholder="참석자 이름을 입력하세요."
                value={meeting.attendees}
                maxLength={500}
                onChange={(e) => patchMeeting({ attendees: e.target.value })}
              />
            </label>
            <label className="consent">
              <input
                type="checkbox"
                checked={meeting.reviewed}
                onChange={(e) => patchMeeting({ reviewed: e.target.checked })}
              />
              <span>제품명, 수치, 결정 사항과 담당자·일정을 확인했습니다.</span>
            </label>
            <div className="modal-action-row">
              <button className="secondary" onClick={() => setMetaOpen(false)}>
                작성 계속
              </button>
              <button
                className="primary"
                disabled={!meeting.reviewed || busy}
                onClick={() => {
                  const data = {
                    ...state.data,
                    meetings: state.data.meetings.map((m) =>
                      m.id === meeting.id
                        ? { ...m, status: "final" as const }
                        : m,
                    ),
                  };
                  update(() => data);
                  void persist(data);
                  setMetaOpen(false);
                }}
              >
                <Check size={15} /> 검토 후 확정
              </button>
            </div>
          </section>
        </div>
      )}
      {meeting && taskOpen && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="후속 업무 등록"
          >
            <div className="section-heading">
              <h2>후속 업무 등록</h2>
              <button
                className="icon-button"
                aria-label="업무 등록 닫기"
                onClick={() => setTaskOpen(false)}
              >
                <X />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  const f = new FormData(e.currentTarget);
                  update((b) =>
                    addTask(b, meeting.id, {
                      title: String(f.get("title")),
                      product: String(f.get("product")),
                      owner: String(f.get("owner")),
                      due: String(f.get("due")),
                      status: "todo",
                    }),
                  );
                  setTaskOpen(false);
                  setStatus(
                    "업무를 추가했습니다. 같은 미완료 업무는 중복 생성하지 않습니다.",
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : "등록 실패");
                }
              }}
            >
              <label>
                업무 내용
                <input name="title" maxLength={500} required />
              </label>
              <label>
                제품 / 안건
                <input
                  name="product"
                  defaultValue={agenda?.product || agenda?.title || ""}
                  maxLength={500}
                />
              </label>
              <div className="form-grid">
                <label>
                  담당자
                  <input
                    name="owner"
                    defaultValue={agenda?.owner || myName}
                    maxLength={80}
                  />
                </label>
                <label>
                  완료 예정일
                  <input name="due" type="date" />
                </label>
              </div>
              <button className="primary full">업무 등록</button>
            </form>
          </section>
        </div>
      )}
      {imported && (
        <div className="modal-backdrop">
          <section
            className="modal ppt-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="PPT 가져오기 미리보기"
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">IMPORT PRESENTATION</span>
                <h2>회의자료에서 가져올 페이지를 선택하세요.</h2>
                <p className="muted">
                  총 {imported.length}페이지 · 이미지{" "}
                  {imported.reduce((n, s) => n + s.files.length, 0)}개
                </p>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="가져오기 취소"
                onClick={() => setImported(null)}
              >
                <X />
              </button>
            </div>
            <div className="import-note">
              업무 보고 / 업무 계획 표는 각각의 작성란으로 나눕니다. 그 외
              페이지는 원문을 보존하며, 제품명·담당자·승인 여부는 임의로 채우지
              않습니다. 애니메이션·도형·차트의 화면 재현은 지원하지 않습니다.
            </div>
            <div className="import-destination">
              <label>
                가져올 위치
                <select
                  value={importAsNew ? "new" : "current"}
                  onChange={(e) => setImportAsNew(e.target.value === "new")}
                >
                  <option value="new">새 주간회의 만들기</option>
                  {meeting && (
                    <option value="current">현재 회의에 안건 추가</option>
                  )}
                </select>
              </label>
              {importAsNew && (
                <label>
                  회의 날짜 · 원문에서 확인
                  <input
                    aria-label="가져올 회의 날짜"
                    type="date"
                    value={importDate}
                    onChange={(e) => setImportDate(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="import-select-all">
              <label className="consent">
                <input
                  type="checkbox"
                  checked={importSelection.length === imported.length}
                  onChange={(e) =>
                    setImportSelection(
                      e.target.checked ? imported.map((s) => s.number) : [],
                    )
                  }
                />
                모든 페이지 선택
              </label>
            </div>
            <div className="import-slides">
              {imported.map((s) => (
                <label key={s.number} className="import-slide">
                  <input
                    type="checkbox"
                    checked={importSelection.includes(s.number)}
                    onChange={(e) =>
                      setImportSelection((prev) =>
                        e.target.checked
                          ? [...prev, s.number]
                          : prev.filter((n) => n !== s.number),
                      )
                    }
                  />
                  <span>
                    <small>
                      PAGE {String(s.number).padStart(2, "0")} ·{" "}
                      {s.files.length}개 이미지
                    </small>
                    <strong>{s.agenda.title}</strong>
                    <p>{s.agenda.report.slice(0, 140)}</p>
                    {s.agenda.plan && <em>업무 계획 별도 추출됨</em>}
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-action-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setImported(null)}
              >
                취소
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !importSelection.length ||
                  (importAsNew && !importDate)
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    const items = await materializeSlides(
                      storage,
                      imported.filter((s) =>
                        importSelection.includes(s.number),
                      ),
                    );
                    const m =
                      !importAsNew && meeting
                        ? meeting
                        : newMeeting(importDate);
                    const data =
                      !importAsNew && meeting
                        ? {
                            ...state.data,
                            meetings: state.data.meetings.map((x) =>
                              x.id === m.id
                                ? {
                                    ...x,
                                    status: "draft" as const,
                                    reviewed: false,
                                    agenda: [...x.agenda, ...items],
                                  }
                                : x,
                            ),
                          }
                        : insertMeeting(state.data, { ...m, agenda: items });
                    update(() => data);
                    setMeetingId(m.id);
                    setAgendaId(items[0]?.id || "");
                    setImported(null);
                    setTab("meeting");
                    setStatus(
                      "PPT의 텍스트와 이미지를 가져왔습니다. 회의 날짜·안건명을 확인하고 저장해 주세요.",
                    );
                  } catch (err) {
                    setError(
                      err instanceof Error ? err.message : "가져오기 실패",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "자료 가져오는 중…"
                  : `${importSelection.length}개 페이지 가져오기`}
              </button>
            </div>
          </section>
        </div>
      )}
      {historyOpen && (
        <div className="modal-backdrop">
          <section
            className="modal ppt-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="수정 이력"
          >
            <div className="section-heading">
              <h2>수정 이력 · 최근 50개 저장</h2>
              <button
                className="icon-button"
                aria-label="이력 닫기"
                onClick={() => setHistoryOpen(false)}
              >
                <X />
              </button>
            </div>
            <div className="history-content">
              {history.map((s) => (
                <button
                  className="history-link"
                  key={s.version}
                  onClick={() => setHistoryVersion(s.version)}
                >
                  <strong>저장 버전 {s.version}</strong>
                  <span>
                    {new Date(s.created_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </span>
                </button>
              ))}
              {historyVersion !== null && (
                <div className="historical-content">
                  {history
                    .find((h) => h.version === historyVersion)
                    ?.data.meetings.map((m) => (
                      <section key={m.id}>
                        <h3>
                          {m.date} · {m.title}
                        </h3>
                        {m.agenda.map((a) => (
                          <article key={a.id}>
                            <h4>
                              {a.title} · {a.owner}
                            </h4>
                            <p>{a.report}</p>
                            <p>다음 계획: {a.plan}</p>
                            <p>결정: {a.decision}</p>
                            {a.visuals.map((v) => (
                              <p key={v.id}>
                                {v.label} · {reviewLabels[v.status]} ·{" "}
                                {v.reviewer} · {v.comment}
                              </p>
                            ))}
                          </article>
                        ))}
                      </section>
                    ))}
                </div>
              )}
              {!history.length && (
                <div className="empty">회의 저장 후 이력이 기록됩니다.</div>
              )}
            </div>
          </section>
        </div>
      )}
      {comparison && comparisonFiles.length === 2 && (
        <CompareDialog
          mode={storage}
          files={comparisonFiles}
          onClose={() => setComparison(false)}
        />
      )}
      {presenting && meeting && (
        <Presentation
          mode={storage}
          agenda={meeting.agenda}
          onClose={() => setPresenting(false)}
          onReview={(a, file) => setReview({ agendaId: a.id, file })}
        />
      )}
      {review && (
        <ReviewDialog
          mode={storage}
          file={review.file}
          onClose={() => setReview(null)}
          onReview={(v) => applyReview(review.agendaId, v)}
        />
      )}
      {aiOpen && meeting && agenda && (
        <ConferenceAI
          meeting={meeting}
          agenda={agenda}
          mode={storage}
          enabled={aiEnabled}
          onClose={() => setAIOpen(false)}
          onChange={patchMeeting}
          onFiles={addFiles}
          onApply={(d) =>
            patchAgenda({
              report: [
                ...d.summary.map((x) => x.text),
                ...d.discussion.map((x) => x.text),
              ].join("\n"),
              decision: d.decisions.map((x) => x.text).join("\n"),
            })
          }
          onTask={(t) =>
            update((b) =>
              addTask(b, meeting.id, {
                title: t.title,
                product: agenda.product,
                owner: t.owner || "",
                due: t.due_date || "",
                status: "todo",
              }),
            )
          }
        />
      )}
    </div>
  );
  function visualCard(a: Agenda, v: Visual, global = false) {
    return (
      <article className="design-card" key={v.id}>
        <div className="design-card-top">
          <label className="compare-check">
            <input
              type="checkbox"
              aria-label={`${v.label} 비교 선택`}
              checked={compareIds.includes(v.id)}
              disabled={!compareIds.includes(v.id) && compareIds.length >= 2}
              onChange={(e) =>
                setCompareIds((ids) =>
                  e.target.checked
                    ? [...ids, v.id]
                    : ids.filter((id) => id !== v.id),
                )
              }
            />
            <span>비교</span>
          </label>
          <span className={`review-badge ${v.status}`}>
            {reviewLabels[v.status]}
          </span>
        </div>
        <AssetImage
          mode={storage}
          file={v}
          onClick={() => setReview({ agendaId: a.id, file: v })}
        />
        <div className="design-card-body">
          {global && (
            <small className="visual-product">{a.product || a.title}</small>
          )}
          <input
            aria-label={`${v.name} 시안 이름`}
            value={v.label}
            maxLength={200}
            onChange={(e) =>
              patchAgenda(
                {
                  visuals: a.visuals.map((x) =>
                    x.id === v.id ? { ...x, label: e.target.value } : x,
                  ),
                },
                a.id,
              )
            }
          />
          <p>{v.comment || "이미지를 눌러 검토 의견을 남겨 주세요."}</p>
          <div>
            <small>{v.reviewer || "검토자 미지정"}</small>
            <button
              className="text-button"
              onClick={() => setReview({ agendaId: a.id, file: v })}
            >
              <Maximize2 size={13} /> 크게 보기
            </button>
          </div>
        </div>
      </article>
    );
  }
}
