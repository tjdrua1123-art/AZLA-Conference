"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { browserDB, configured } from "@/lib/supabase-browser";
import {
  type Meeting,
  type Task,
  type Profile,
  canWrite,
  nextMonday,
  filterMeetings,
} from "@/lib/types";
import { demoMeetings, demoPeople, demoTasks } from "@/lib/demo";
import MeetingEditor from "./meeting-editor";
const taskLabels = { todo: "진행 전", doing: "진행 중", done: "완료" };
export default function Workspace() {
  const [demo] = useState(() => !configured());
  const [loading, setLoading] = useState(!demo);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>(demo ? demoPeople : []);
  const [meetings, setMeetings] = useState<Meeting[]>(demo ? demoMeetings : []);
  const [tasks, setTasks] = useState<Task[]>(demo ? demoTasks : []);
  const [tab, setTab] = useState("dashboard");
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [create, setCreate] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [password, setPassword] = useState("");
  const [taskFilter, setTaskFilter] = useState("all");
  const load = useCallback(async () => {
    if (demo) return;
    try {
      const db = browserDB();
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) {
        window.location.assign("/login");
        return;
      }
      const p = await db
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!p.data?.active) {
        setError("활성화된 직원 계정이 아닙니다. 관리자에게 문의해 주세요.");
        setLoading(false);
        return;
      }
      setProfile(p.data);
      const readAll = async (table: string, order: string) => {
        const result: Record<string, unknown>[] = [];
        for (let start = 0; ; start += 500) {
          const r = await db
            .from(table)
            .select("*")
            .order(order, { ascending: false })
            .range(start, start + 499);
          if (r.error) throw r.error;
          result.push(...r.data);
          if (r.data.length < 500) break;
        }
        return result;
      };
      const [m, t, ps] = await Promise.all([
        readAll("meetings", "meeting_date"),
        readAll("tasks", "created_at"),
        readAll("profiles", "name"),
      ]);
      setMeetings(m as Meeting[]);
      setTasks(t as Task[]);
      setPeople(ps as Profile[]);
    } catch {
      setError(
        "데이터를 불러오지 못했습니다. Supabase 연결 및 DB 정책을 확인해 주세요.",
      );
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void load();
    setWelcome(
      new URLSearchParams(window.location.search).get("welcome") === "1",
    );
  }, [load]);
  const writable = canWrite(profile);
  const active = tasks.filter((t) => t.status !== "done");
  const products = [
    ...new Set(
      [
        ...meetings.map((m) => m.product),
        ...tasks.map((t) => t.product),
      ].filter(Boolean),
    ),
  ];
  const visible = filterMeetings(meetings, query, product, date);
  const titles: Record<string, string> = {
    dashboard: "대시보드",
    meetings: "주간회의록",
    tasks: "업무 진행 현황",
    products: "제품 개발 이력",
    staff: "직원 관리",
  };
  async function updateTask(t: Task, status: Task["status"]) {
    if (!writable) return;
    const { error } = await browserDB()
      .from("tasks")
      .update({ status })
      .eq("id", t.id);
    if (error) setError("업무 상태 변경에 실패했습니다.");
    else await load();
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          AZLA<span>WORKSPACE</span>
        </a>
        <div className="workspace-tag">
          <span className="green-dot" /> AZLA 팀 워크스페이스{" "}
          <ShieldCheck size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            { id: "dashboard", label: "대시보드", icon: LayoutDashboard },
            { id: "meetings", label: "주간회의록", icon: FileText },
            { id: "tasks", label: "업무 진행 현황", icon: ClipboardList },
            { id: "products", label: "제품 개발 이력", icon: FolderKanban },
            ...(profile?.role === "admin"
              ? [{ id: "staff", label: "직원 관리", icon: Users }]
              : []),
          ].map((n) => (
            <button
              className={tab === n.id ? "nav-item active" : "nav-item"}
              key={n.id}
              onClick={() => {
                setTab(n.id);
                setProduct("");
                setQuery("");
                setDate("");
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "tasks" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <AudioLines size={22} />
          <strong>
            회의의 기록이
            <br />
            제품의 다음이 됩니다.
          </strong>
          <p>
            매주의 논의와 결정을
            <br />
            하나의 흐름으로 연결하세요.
          </p>
        </div>
        <div className="profile">
          <div className="avatar">
            {demo ? "A" : profile?.name.slice(0, 1) || "A"}
          </div>
          <div>
            <strong>
              {demo ? "미리보기" : profile?.name || "직원 확인 중"}
            </strong>
            <small>
              {demo
                ? "샘플 워크스페이스"
                : profile?.role === "admin"
                  ? "관리자"
                  : profile?.role === "editor"
                    ? "작성자"
                    : "열람자"}
            </small>
          </div>
          {!demo && (
            <button
              className="icon-button"
              aria-label="로그아웃"
              onClick={async () => {
                await browserDB().auth.signOut();
                window.location.assign("/login");
              }}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={14} />{" "}
            <strong>{titles[tab]}</strong>
          </div>
          <div className="topbar-right">
            <span className="private">
              <ShieldCheck size={14} /> 사내 전용
            </span>
            <span className="top-date">
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                year: "numeric",
                month: "long",
                day: "numeric",
                weekday: "short",
              }).format(new Date())}
            </span>
          </div>
        </header>
        <main className="content">
          {demo && (
            <div className="demo-banner">
              <span>
                <strong>화면 미리보기</strong> · 아래 내용은 샘플입니다.
                Supabase 연결 후 실제 업무를 시작할 수 있습니다.
              </span>
              <a href="/login">
                직원 로그인 <ArrowRight size={14} />
              </a>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError("");
                  void load();
                }}
              >
                다시 확인
              </button>
            </div>
          )}
          {welcome && (
            <div className="notice">
              <strong>
                초대를 환영합니다. 로그인 비밀번호를 설정해 주세요.
              </strong>
              <form
                className="inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const { error } = await browserDB().auth.updateUser({
                    password,
                  });
                  if (error)
                    setError(
                      "비밀번호 설정에 실패했습니다. 12자 이상 입력해 주세요.",
                    );
                  else {
                    setWelcome(false);
                    window.history.replaceState(null, "", "/");
                  }
                }}
              >
                <input
                  aria-label="새 비밀번호"
                  type="password"
                  minLength={12}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button className="primary">비밀번호 설정</button>
              </form>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">AZLA WEEKLY CONFERENCE</div>
              <h1>
                {tab === "dashboard" ? "팀의 이번 주를 한눈에." : titles[tab]}
              </h1>
              <p>
                {tab === "dashboard"
                  ? "회의의 결정부터 제품 개발의 진행 상황까지, 함께 확인하세요."
                  : tab === "meetings"
                    ? "매주의 논의와 결정을 기록하고 지난 회의를 찾아보세요."
                    : tab === "tasks"
                      ? "지난 회의의 약속을 확인하고, 다음 단계를 이어가세요."
                      : tab === "products"
                        ? "제품을 중심으로 회의와 개발 업무의 흐름을 확인하세요."
                        : "초대된 직원과 접근 권한을 관리합니다."}
              </p>
            </div>
            {(tab === "dashboard" || tab === "meetings") && (
              <button
                className="primary"
                onClick={() =>
                  demo
                    ? setError(
                        "샘플 미리보기입니다. 실제 회의 작성은 Supabase 연결과 직원 로그인이 필요합니다.",
                      )
                    : setCreate(true)
                }
                disabled={!demo && !writable}
              >
                <Plus size={17} /> 새 회의록
              </button>
            )}
          </div>
          {loading ? (
            <div className="empty">워크스페이스를 불러오는 중입니다…</div>
          ) : (
            <>
              {tab === "dashboard" && (
                <>
                  <div className="stats-grid">
                    {[
                      {
                        label: "전체 회의록",
                        n: meetings.length,
                        unit: "건",
                        icon: FileText,
                        caption: "차곡차곡 쌓이는 팀의 기록",
                        tone: "blue",
                      },
                      {
                        label: "진행 중인 업무",
                        n: active.length,
                        unit: "건",
                        icon: Clock3,
                        caption: `진행 전 ${tasks.filter((t) => t.status === "todo").length} · 진행 중 ${tasks.filter((t) => t.status === "doing").length}`,
                        tone: "orange",
                      },
                      {
                        label: "완료된 업무",
                        n: tasks.filter((t) => t.status === "done").length,
                        unit: "건",
                        icon: Check,
                        caption: "한 걸음씩 만들어가는 성과",
                        tone: "green",
                      },
                      {
                        label: "개발 중인 제품",
                        n: products.length,
                        unit: "개",
                        icon: FolderKanban,
                        caption: "제품별 회의와 업무 이력",
                        tone: "purple",
                      },
                    ].map((s) => (
                      <div className="stat-card" key={s.label}>
                        <div className="stat-top">
                          {s.label}
                          <span className={`stat-icon ${s.tone}`}>
                            <s.icon size={19} />
                          </span>
                        </div>
                        <div className="stat-number">
                          {s.n}
                          <small>{s.unit}</small>
                        </div>
                        <p>{s.caption}</p>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-grid">
                    <section className="panel recent">
                      <div className="section-heading">
                        <h2>
                          최근 주간회의록{" "}
                          <span className="tiny-count">{meetings.length}</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => setTab("meetings")}
                        >
                          전체 보기 <ArrowRight size={14} />
                        </button>
                      </div>
                      {meetings.length === 0 ? (
                        <div className="empty">
                          <FileText />
                          <h3>첫 주간회의를 기록해 보세요.</h3>
                          <p>
                            새 회의록을 만들면 미완료 업무가 자동으로
                            연결됩니다.
                          </p>
                        </div>
                      ) : (
                        meetings.slice(0, 4).map((m, i) => (
                          <button
                            key={m.id}
                            className="meeting-row"
                            onClick={() => setSelected(m)}
                          >
                            <div
                              className={`date-tile ${i === 0 ? "latest" : ""}`}
                            >
                              <small>{m.meeting_date.slice(5, 7)}월</small>
                              <strong>{m.meeting_date.slice(8)}</strong>
                            </div>
                            <div className="meeting-info">
                              <div>
                                <h3>{m.title}</h3>
                                <span
                                  className={`badge ${m.status === "final" ? "neutral" : "orange"}`}
                                >
                                  {m.status === "final" ? "확정" : "작성 중"}
                                </span>
                              </div>
                              <p>{m.agenda || "안건을 작성해 주세요."}</p>
                              <small>
                                <span className="product-tag">
                                  {m.product || "공통"}
                                </span>
                                <span>수정 이력 v{m.version}</span>
                              </small>
                            </div>
                            <ChevronRight size={18} className="muted" />
                          </button>
                        ))
                      )}
                    </section>
                    <section className="weekly-card">
                      <div className="weekly-icon">
                        <CalendarDays size={23} />
                      </div>
                      <span className="eyebrow">NEXT CONFERENCE</span>
                      <h2>
                        다음 주를 준비하는
                        <br />
                        가장 확실한 방법.
                      </h2>
                      <p>
                        미완료 업무는 새 회의로 이어집니다.
                        <br />
                        지난 논의를 놓치지 않고 시작하세요.
                      </p>
                      <div className="next-date">
                        <span>다음 월요일</span>
                        <strong>{nextMonday().replaceAll("-", ". ")}</strong>
                      </div>
                      <button
                        onClick={() => {
                          if (demo)
                            setError(
                              "Supabase 연결 후 회의를 작성할 수 있습니다.",
                            );
                          else setCreate(true);
                        }}
                        disabled={!demo && !writable}
                      >
                        회의록 미리 준비하기 <ArrowRight size={16} />
                      </button>
                      <div className="wave-art" aria-hidden="true">
                        {Array.from({ length: 29 }, (_, i) => (
                          <i
                            key={i}
                            style={{
                              height: `${12 + Math.sin(i * 0.55) ** 2 * 54}px`,
                            }}
                          />
                        ))}
                      </div>
                    </section>
                  </div>
                  <section className="panel task-panel">
                    <div className="section-heading">
                      <h2>
                        이번 주 확인할 업무{" "}
                        <span className="tiny-count">{active.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => setTab("tasks")}
                      >
                        모든 업무 보기 <ArrowRight size={14} />
                      </button>
                    </div>
                    {taskTable(active.slice(0, 5))}
                  </section>
                  <div className="bottom-note">
                    <ShieldCheck size={14} /> 회의록과 첨부파일은 직원에게만
                    공유됩니다.<span>AZLA · Better sound, together.</span>
                  </div>
                </>
              )}
              {tab === "meetings" && (
                <>
                  <div className="filters">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        aria-label="회의록 키워드 검색"
                        placeholder="제목, 안건, 회의 내용 검색"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="제품별 검색"
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                    >
                      <option value="">모든 제품</option>
                      {products.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <input
                      aria-label="회의 날짜 검색"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                    <button
                      className="secondary"
                      onClick={() => {
                        setQuery("");
                        setProduct("");
                        setDate("");
                      }}
                    >
                      초기화
                    </button>
                  </div>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>
                        회의 기록{" "}
                        <span className="tiny-count">{visible.length}</span>
                      </h2>
                    </div>
                    {visible.map((m) => (
                      <button
                        className="meeting-row"
                        key={m.id}
                        onClick={() => setSelected(m)}
                      >
                        <div className="date-tile">
                          <small>{m.meeting_date.slice(0, 7)}</small>
                          <strong>{m.meeting_date.slice(8)}</strong>
                        </div>
                        <div className="meeting-info">
                          <div>
                            <h3>{m.title}</h3>
                            <span
                              className={`badge ${m.status === "final" ? "neutral" : "orange"}`}
                            >
                              {m.status === "final" ? "확정" : "작성 중"}
                            </span>
                          </div>
                          <p>{m.agenda}</p>
                          <small>
                            {m.product || "공통"} · 버전 {m.version}
                          </small>
                        </div>
                        <ChevronRight size={18} />
                      </button>
                    ))}
                    {visible.length === 0 && (
                      <div className="empty">
                        조건에 맞는 회의록이 없습니다.
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === "tasks" && (
                <>
                  <div className="filters">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        placeholder="업무 또는 제품 검색"
                        aria-label="업무 검색"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="업무 상태 필터"
                      value={taskFilter}
                      onChange={(e) => setTaskFilter(e.target.value)}
                    >
                      <option value="all">모든 상태</option>
                      {Object.entries(taskLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>팀 업무</h2>
                      <span className="muted">
                        새 업무는 해당 회의록에서 등록하세요.
                      </span>
                    </div>
                    {taskTable(
                      tasks.filter(
                        (t) =>
                          (taskFilter === "all" || t.status === taskFilter) &&
                          `${t.title} ${t.product}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      ),
                    )}
                  </section>
                </>
              )}
              {tab === "products" && (
                <div className="product-grid">
                  {products.map((p) => (
                    <section className="panel product-card" key={p}>
                      <FolderKanban className="product-symbol" size={25} />
                      <h2>{p}</h2>
                      <p className="muted">
                        회의 {meetings.filter((m) => m.product === p).length}건
                        · 미완료 업무{" "}
                        {
                          tasks.filter(
                            (t) => t.product === p && t.status !== "done",
                          ).length
                        }
                        건
                      </p>
                      {meetings
                        .filter((m) => m.product === p)
                        .map((m) => (
                          <button
                            className="history-link"
                            key={m.id}
                            onClick={() => setSelected(m)}
                          >
                            <span>
                              {m.meeting_date}
                              <strong>{m.title}</strong>
                            </span>
                            <ChevronRight size={15} />
                          </button>
                        ))}
                      {tasks
                        .filter((t) => t.product === p)
                        .map((t) => (
                          <div className="product-task" key={t.id}>
                            <span className={`status-dot ${t.status}`} />
                            {t.title}
                            <small>{taskLabels[t.status]}</small>
                          </div>
                        ))}
                    </section>
                  ))}
                  {products.length === 0 && (
                    <div className="empty">
                      회의록에 제품명을 입력하면 개발 이력을 모아 볼 수
                      있습니다.
                    </div>
                  )}
                </div>
              )}
              {tab === "staff" && profile?.role === "admin" && (
                <Staff
                  people={people}
                  current={profile.id}
                  refresh={load}
                  onError={setError}
                />
              )}
            </>
          )}
          <footer>
            © {new Date().getFullYear()} AZLA <span>주간회의 워크스페이스</span>
          </footer>
        </main>
      </div>
      {selected && (
        <MeetingEditor
          meeting={selected}
          demo={demo}
          profile={profile}
          people={people}
          allTasks={tasks}
          onClose={() => {
            setSelected(null);
            void load();
          }}
          onSaved={async (m) => {
            setSelected(m);
            await load();
          }}
        />
      )}
      {create && (
        <div className="modal-backdrop">
          <section
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-label="새 주간회의"
          >
            <div className="section-heading">
              <h2>새 주간회의</h2>
              <button
                className="icon-button"
                aria-label="닫기"
                onClick={() => setCreate(false)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              이전 회의의 미완료 업무를 자동으로 연결합니다.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const f = new FormData(e.currentTarget);
                  const db = browserDB();
                  const { data, error } = await db.rpc(
                    "create_weekly_meeting",
                    {
                      p_date: f.get("date"),
                      p_title: f.get("title"),
                      p_product: f.get("product"),
                      p_agenda: f.get("agenda"),
                    },
                  );
                  if (error) throw error;
                  const m = await db
                    .from("meetings")
                    .select("*")
                    .eq("id", data)
                    .single();
                  if (m.error) throw m.error;
                  setCreate(false);
                  await load();
                  setSelected(m.data);
                } catch {
                  setError(
                    "회의를 생성하지 못했습니다. 입력값 및 DB 설정을 확인해 주세요.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                회의 날짜
                <input
                  name="date"
                  type="date"
                  defaultValue={nextMonday()}
                  required
                />
              </label>
              <label>
                회의 제목
                <input
                  name="title"
                  defaultValue="AZLA 주간회의"
                  maxLength={200}
                  required
                />
              </label>
              <label>
                제품명
                <input
                  name="product"
                  list="products"
                  placeholder="예: SEDNAEARFIT"
                />
                <datalist id="products">
                  {products.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </datalist>
              </label>
              <label>
                안건
                <textarea
                  name="agenda"
                  rows={3}
                  placeholder="이번 주에 논의할 내용을 입력하세요."
                />
              </label>
              <button disabled={busy} className="primary full">
                {busy ? "생성 중…" : "회의록 만들기"}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
  function taskTable(items: Task[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>업무 내용</th>
              <th>제품</th>
              <th>담당자</th>
              <th>완료 예정일</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className={`status-dot ${t.status}`} />
                  {t.title}
                </td>
                <td>
                  <span className="product-tag">{t.product || "공통"}</span>
                </td>
                <td>
                  <span className="mini-avatar">
                    {people
                      .find((p) => p.id === t.owner_id)
                      ?.name.slice(0, 1) || "–"}
                  </span>
                  {people.find((p) => p.id === t.owner_id)?.name || "미지정"}
                </td>
                <td className="muted">
                  {t.due_date?.replaceAll("-", ".") || "미정"}
                </td>
                <td>
                  {writable ? (
                    <select
                      className={`status-select ${t.status}`}
                      aria-label={`${t.title} 상태`}
                      value={t.status}
                      onChange={(e) =>
                        void updateTask(t, e.target.value as Task["status"])
                      }
                    >
                      {Object.entries(taskLabels).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`badge ${t.status === "done" ? "green" : t.status === "doing" ? "blue" : "neutral"}`}
                    >
                      {taskLabels[t.status]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="empty">등록된 업무가 없습니다.</div>
        )}
      </div>
    );
  }
}
function Staff({
  people,
  current,
  refresh,
  onError,
}: {
  people: Profile[];
  current: string;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function send(body: unknown) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "처리에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel padded">
        <h2>직원 초대</h2>
        <p className="muted">
          초대 이메일을 보냅니다. 직원은 초대 링크에서 비밀번호를 설정합니다.
        </p>
        <form
          className="invite-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await send({
              action: "invite",
              name: f.get("name"),
              email: f.get("email"),
              role: f.get("role"),
            });
          }}
        >
          <input
            aria-label="직원 이름"
            name="name"
            placeholder="이름"
            required
            maxLength={100}
          />
          <input
            aria-label="직원 이메일"
            name="email"
            type="email"
            placeholder="회사 이메일"
            required
          />
          <select name="role" aria-label="초대 권한">
            <option value="viewer">열람자</option>
            <option value="editor">작성자</option>
            <option value="admin">관리자</option>
          </select>
          <button className="primary" disabled={busy}>
            초대 보내기
          </button>
        </form>
      </section>
      <section className="panel padded">
        <h2>직원 및 권한</h2>
        {people.map((p) => (
          <div className="staff-row" key={p.id}>
            <strong>{p.name}</strong>
            <span className="muted">{p.active ? "활성" : "비활성"}</span>
            <select
              aria-label={`${p.name} 권한`}
              value={p.role}
              disabled={busy || p.id === current}
              onChange={(e) =>
                void send({
                  action: "update",
                  id: p.id,
                  role: e.target.value,
                  active: p.active,
                })
              }
            >
              <option value="admin">관리자</option>
              <option value="editor">작성자</option>
              <option value="viewer">열람자</option>
            </select>
            <button
              className="secondary"
              disabled={busy || p.id === current}
              onClick={() =>
                void send({
                  action: "update",
                  id: p.id,
                  role: p.role,
                  active: !p.active,
                })
              }
            >
              {p.active ? "비활성화" : "활성화"}
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
