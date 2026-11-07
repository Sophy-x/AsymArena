import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Eye,
  EyeOff,
  FileClock,
  Gamepad2,
  KeyRound,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import type {
  ArenaBridge,
  CreateMatchInput,
  EloChange,
  GameDescriptor,
  GameSnapshot,
  MatchSummary,
  ModelProfile,
  ModelProfileSummary,
  PrivateObservation,
  RatingEntry,
  ReplayData,
  SeatConfig,
} from "@shared/types";

type Page =
  "overview" | "matches" | "ratings" | "models" | "match" | "replay" | "setup";

const initialProfile = (): ModelProfile => ({
  id: crypto.randomUUID(),
  name: "",
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
});

const presets = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  { name: "OpenAI-compatible", baseUrl: "" },
];

function formatDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ratingDelta(entry?: EloChange): string {
  if (!entry) return "—";
  return `${entry.delta > 0 ? "+" : ""}${entry.delta.toFixed(1)}`;
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [games, setGames] = useState<GameDescriptor[]>([]);
  const [profiles, setProfiles] = useState<ModelProfileSummary[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [ratings, setRatings] = useState<RatingEntry[]>([]);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [profileEditor, setProfileEditor] = useState(false);

  const refresh = async () => {
    const data = await window.arena.getBootstrap();
    setGames(data.games);
    setProfiles(data.profiles);
    setMatches(data.matches);
    setRatings(data.ratings);
  };

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const unsubscribe = window.arena.onMatchUpdated((next) => {
      setSnapshot((current) =>
        current?.matchId === next.matchId ? next : current,
      );
      void refresh();
    });
    return unsubscribe;
  }, []);

  const notify = (kind: "error" | "success", text: string) => {
    setBanner({ kind, text });
    window.setTimeout(() => setBanner(null), 4800);
  };

  const openMatch = async (matchId: string) => {
    setSelectedMatchId(matchId);
    setPage("match");
    try {
      setSnapshot(await window.arena.getMatch(matchId));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "无法读取对局");
    }
  };

  const openReplay = async (matchId: string) => {
    setSelectedMatchId(matchId);
    setPage("replay");
    try {
      setReplay(await window.arena.getReplay(matchId));
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "无法读取回放");
    }
  };

  const startMatch = async (input: CreateMatchInput) => {
    try {
      const created = await window.arena.createMatch(input);
      setSelectedMatchId(created.matchId);
      setSnapshot(await window.arena.startMatch(created.matchId));
      setPage("match");
      await refresh();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "创建对局失败");
    }
  };

  const nav = [
    { id: "overview" as const, label: "总览", icon: Activity },
    {
      id: "matches" as const,
      label: "对局",
      icon: Gamepad2,
      count: matches.filter((match) =>
        ["running", "waiting-human", "paused"].includes(match.status),
      ).length,
    },
    { id: "ratings" as const, label: "Elo 排名", icon: Trophy },
    {
      id: "models" as const,
      label: "模型接入",
      icon: Bot,
      count: profiles.length,
    },
  ];

  if (loading)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={22} />
        正在打开本地竞技场
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <div className="brand-name">ASYMARENA</div>
            <div className="brand-caption">AGENT GAME LAB</div>
          </div>
        </div>
        <div className="workspace-switch">
          <span className="workspace-dot" />
          本地工作区
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">ARENA</div>
        <nav className="primary-nav">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? "selected" : ""}`}
              onClick={() => setPage(id)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {count ? <span className="nav-count">{count}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-dot" />
            本地引擎就绪
          </div>
          <div className="sidebar-user">
            <div className="user-avatar">AA</div>
            <div className="user-meta">
              <strong>Local Operator</strong>
              <span>桌面实例</span>
            </div>
            <Settings2 size={16} />
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>AsymArena</span>
            <span className="crumb-divider">/</span>
            <strong>{pageTitle(page)}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-chip">
              <span />
              LOCAL
            </span>
            <span className="topbar-divider" />
            <button className="icon-button" title="帮助">
              <CircleHelp size={17} />
            </button>
            <div className="top-avatar">A</div>
          </div>
        </header>
        {banner && (
          <div className={`toast ${banner.kind}`}>
            <span>{banner.text}</span>
            <button onClick={() => setBanner(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="page-content">
          {page === "overview" && (
            <Overview
              games={games}
              profiles={profiles}
              matches={matches}
              ratings={ratings}
              onNew={() => setPage("setup")}
              onOpen={openMatch}
              onRatings={() => setPage("ratings")}
            />
          )}
          {page === "matches" && (
            <MatchesPage
              matches={matches}
              onNew={() => setPage("setup")}
              onOpen={openMatch}
              onReplay={openReplay}
            />
          )}
          {page === "ratings" && (
            <RatingsPage ratings={ratings} games={games} />
          )}
          {page === "models" && (
            <ModelsPage
              profiles={profiles}
              onChanged={refresh}
              onNotify={notify}
              editorOpen={profileEditor}
              setEditorOpen={setProfileEditor}
            />
          )}
          {page === "setup" && (
            <SetupPage
              games={games}
              profiles={profiles}
              onBack={() => setPage("matches")}
              onStart={startMatch}
              onAddModel={() => {
                setProfileEditor(true);
                setPage("models");
              }}
            />
          )}
          {page === "match" && snapshot && selectedMatchId && (
            <MatchPage
              key={snapshot.matchId}
              snapshot={snapshot}
              onBack={() => setPage("matches")}
              onRetry={async () => {
                try {
                  setSnapshot(await window.arena.retryMatch(snapshot.matchId));
                } catch (error) {
                  notify("error", String(error));
                }
              }}
              onHumanAction={async (seatId, tool, args) => {
                try {
                  setSnapshot(
                    await window.arena.submitHumanAction(
                      snapshot.matchId,
                      seatId,
                      tool,
                      args,
                    ),
                  );
                } catch (error) {
                  notify(
                    "error",
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
              onReplay={() => openReplay(snapshot.matchId)}
            />
          )}
          {page === "replay" && replay && (
            <ReplayPage replay={replay} onBack={() => setPage("matches")} />
          )}
          {page === "match" && !snapshot && (
            <div className="empty-state">选择一场对局查看实时状态。</div>
          )}
          {page === "replay" && !replay && (
            <div className="empty-state">选择一场已完成的对局查看回放。</div>
          )}
        </div>
      </main>
    </div>
  );
}

function pageTitle(page: Page): string {
  return {
    overview: "总览",
    matches: "对局管理",
    ratings: "Elo 排名",
    models: "模型接入",
    setup: "新建对局",
    match: "实时对局",
    replay: "对局回放",
  }[page];
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({
  games,
  profiles,
  matches,
  ratings,
  onNew,
  onOpen,
  onRatings,
}: {
  games: GameDescriptor[];
  profiles: ModelProfileSummary[];
  matches: MatchSummary[];
  ratings: RatingEntry[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onRatings: () => void;
}) {
  const active = matches.filter((match) =>
    ["running", "waiting-human", "paused"].includes(match.status),
  );
  const complete = matches.filter((match) => match.status === "finished");
  const game = games[0];
  return (
    <>
      <PageHeading
        eyebrow="ARENA OVERVIEW"
        title="智能体竞技场"
        subtitle="配置模型、组建阵容，让不同智能体在同一套隐藏信息规则下交锋。"
        action={
          <button className="button primary" onClick={onNew}>
            <Plus size={16} />
            创建对局
          </button>
        }
      />
      <div className="stat-grid">
        <StatCard
          label="接入模型"
          value={profiles.length.toString().padStart(2, "0")}
          note={
            profiles.length
              ? `${profiles.filter((p) => p.hasApiKey).length} 个凭据已加密`
              : "尚未配置模型"
          }
          icon={<Bot size={17} />}
          tint="mint"
        />
        <StatCard
          label="进行中"
          value={active.length.toString().padStart(2, "0")}
          note="包括等待人类行动"
          icon={<Radio size={17} />}
          tint="blue"
        />
        <StatCard
          label="已完成对局"
          value={complete.length.toString().padStart(2, "0")}
          note="计入各游戏独立 Elo"
          icon={<Gamepad2 size={17} />}
          tint="amber"
        />
        <StatCard
          label="已注册游戏"
          value={games.length.toString().padStart(2, "0")}
          note="游戏模块独立接入"
          icon={<Sparkles size={17} />}
          tint="coral"
        />
      </div>
      <div className="overview-columns">
        <section className="surface-panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>最近对局</h2>
              <p>本地保存的比赛与状态</p>
            </div>
            <button
              className="text-button"
              onClick={onOpen ? () => onOpen(matches[0]?.matchId) : undefined}
              disabled={!matches.length}
            >
              查看详情 <ArrowRight size={14} />
            </button>
          </div>
          {matches.length ? (
            <div className="match-list compact">
              {matches.slice(0, 5).map((match) => (
                <MatchRow key={match.matchId} match={match} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <EmptyBlock
              icon={<Gamepad2 size={20} />}
              title="还没有对局"
              body="创建一场新比赛，指定游戏和参赛模型。"
              action={
                <button className="button secondary small" onClick={onNew}>
                  创建第一场 <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </section>
        <section className="surface-panel ranking-panel">
          <div className="panel-heading">
            <div>
              <h2>Elo 领跑</h2>
              <p>按游戏分别计算的模型评分</p>
            </div>
            <button
              className="icon-button"
              onClick={onRatings}
              title="查看完整排名"
            >
              <ArrowRight size={16} />
            </button>
          </div>
          {ratings.length ? (
            <div className="leader-list">
              {ratings.slice(0, 5).map((entry, index) => (
                <div
                  className="leader-row"
                  key={`${entry.gameId}:${entry.profileId}`}
                >
                  <span className={`rank-number rank-${index + 1}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="leader-avatar">
                    {entry.profileName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="leader-ident">
                    <strong>{entry.profileName}</strong>
                    <span>
                      {entry.gameName} · {entry.games} 场
                    </span>
                  </div>
                  <strong className="rating-number">
                    {Math.round(entry.rating)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock
              icon={<Trophy size={19} />}
              title="排名尚未建立"
              body="完成对局后自动更新模型 Elo。"
            />
          )}
        </section>
      </div>
      <div className="section-label">
        <span>GAME MODULE</span>
        <span className="section-rule" />
      </div>
      {game && <GameModuleCard game={game} onNew={onNew} />}
    </>
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  tint,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tint: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tint}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

function EmptyBlock({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-block">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function GameModuleCard({
  game,
  onNew,
}: {
  game: GameDescriptor;
  onNew: () => void;
}) {
  return (
    <div className="game-module-card">
      <div className="game-cover">
        <div className="cover-grid" />
        <div className="cover-stamp">
          GAME
          <br />
          MODULE 01
        </div>
        <div className="cover-words">
          <span>WHO</span>
          <span>IS</span>
          <span>UNDERCOVER</span>
        </div>
        <div className="cover-orbit orbit-one" />
        <div className="cover-orbit orbit-two" />
        <div className="cover-point point-one" />
        <div className="cover-point point-two" />
        <div className="cover-point point-three" />
      </div>
      <div className="game-module-info">
        <div className="game-module-top">
          <div>
            <div className="eyebrow">
              {game.id.toUpperCase()} · v{game.version}
            </div>
            <h2>{game.name}</h2>
          </div>
          <span className="module-active">
            <span />
            READY
          </span>
        </div>
        <p>{game.description}</p>
        <div className="module-specs">
          <div>
            <span>座位数</span>
            <strong>
              {game.minSeats}–{game.maxSeats}
            </strong>
          </div>
          <div>
            <span>MCP 工具</span>
            <strong>{game.mcpToolCount} 个</strong>
          </div>
          <div>
            <span>赛制</span>
            <strong>阵营对抗</strong>
          </div>
        </div>
        <button className="button secondary" onClick={onNew}>
          使用此游戏 <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function MatchesPage({
  matches,
  onNew,
  onOpen,
  onReplay,
}: {
  matches: MatchSummary[];
  onNew: () => void;
  onOpen: (id: string) => void;
  onReplay: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  const filtered = matches.filter(
    (match) =>
      filter === "all" ||
      (filter === "active"
        ? ["running", "waiting-human", "paused"].includes(match.status)
        : match.status === "finished"),
  );
  const emptyAction =
    filter === "all" ? (
      <button className="button secondary small" onClick={onNew}>
        新建对局 <ArrowRight size={14} />
      </button>
    ) : undefined;
  return (
    <>
      <PageHeading
        eyebrow="MATCH OPERATIONS"
        title="对局管理"
        subtitle="查看正在运行、等待真人行动和已完成的 AI 比赛。"
        action={
          <button className="button primary" onClick={onNew}>
            <Plus size={16} />
            新建对局
          </button>
        }
      />
      <div className="toolbar">
        <div className="segmented">
          {(
            [
              ["all", "全部"],
              ["active", "进行中"],
              ["finished", "已完成"],
            ] as const
          ).map(([key, label]) => {
            const count =
              key === "all"
                ? matches.length
                : key === "active"
                  ? matches.filter((match) =>
                      ["running", "waiting-human", "paused"].includes(
                        match.status,
                      ),
                    ).length
                  : matches.filter((match) => match.status === "finished")
                      .length;
            return (
              <button
                key={key}
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="按模型或对局 ID 筛选"
            onChange={() => undefined}
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="surface-panel table-panel">
          <div className="match-list">
            {filtered.map((match) => (
              <MatchRow
                key={match.matchId}
                match={match}
                onOpen={onOpen}
                onReplay={onReplay}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="surface-panel">
          <EmptyBlock
            icon={<FileClock size={20} />}
            title="没有匹配的对局"
            body={
              filter === "all"
                ? "创建第一场比赛开始积累模型对战样本。"
                : "尝试切换筛选条件。"
            }
            action={emptyAction}
          />
        </div>
      )}
    </>
  );
}

function MatchRow({
  match,
  onOpen,
  onReplay,
}: {
  match: MatchSummary;
  onOpen: (id: string) => void;
  onReplay?: (id: string) => void;
}) {
  const status = statusMeta(match.status);
  return (
    <div className="match-row">
      <div
        className={`match-game-mark ${match.status === "finished" ? "done" : ""}`}
      >
        <Gamepad2 size={18} />
      </div>
      <div className="match-primary">
        <div className="match-title-line">
          <strong>{match.gameName}</strong>
          <span className={`status-pill ${status.className}`}>
            <span />
            {status.label}
          </span>
        </div>
        <div className="match-subline">
          <span>{match.seats.map((seat) => seat.name).join(" · ")}</span>
          <span className="dot-separator">·</span>
          <span>
            第 {match.round}/{match.maxRounds} 轮 · {match.phaseLabel}
          </span>
        </div>
      </div>
      <div className="match-date">
        <Clock3 size={13} />
        {formatDate(match.createdAt)}
      </div>
      <div className="match-outcome">
        {match.outcome ?? match.error ?? `${match.seats.length} seats`}
      </div>
      {match.status === "finished" && onReplay ? (
        <button className="row-action" onClick={() => onReplay(match.matchId)}>
          回放 <ArrowRight size={14} />
        </button>
      ) : (
        <button className="row-action" onClick={() => onOpen(match.matchId)}>
          {match.status === "finished" ? "查看" : "打开"}{" "}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

function statusMeta(status: MatchSummary["status"]) {
  return {
    setup: { label: "待开始", className: "idle" },
    running: { label: "进行中", className: "running" },
    "waiting-human": { label: "等待玩家", className: "waiting" },
    paused: { label: "已暂停", className: "paused" },
    finished: { label: "已结束", className: "finished" },
  }[status];
}

function RatingsPage({
  ratings,
  games,
}: {
  ratings: RatingEntry[];
  games: GameDescriptor[];
}) {
  const [gameId, setGameId] = useState("all");
  const shown = ratings.filter(
    (entry) => gameId === "all" || entry.gameId === gameId,
  );
  return (
    <>
      <PageHeading
        eyebrow="COMPETITIVE RATINGS"
        title="Elo 排名"
        subtitle="按游戏分别维护评分。多人阵营赛以队伍平均分估算预期赛果。"
      />
      <div className="rating-explainer">
        <div className="rating-formula">
          <span className="formula-icon">
            <Trophy size={17} />
          </span>
          <div>
            <strong>Team Elo · K = 32</strong>
            <p>
              队伍平均分决定赛前预期，阵营赛果变化分数平均分配给模型座位。真人席位参与比赛，但不进入模型榜单。
            </p>
          </div>
        </div>
        <div className="rating-scope">
          <span>评分范围</span>
          <strong>
            {gameId === "all"
              ? "所有游戏分榜"
              : games.find((g) => g.id === gameId)?.name}
          </strong>
        </div>
      </div>
      <div className="rating-filters">
        <button
          className={gameId === "all" ? "selected" : ""}
          onClick={() => setGameId("all")}
        >
          全部游戏
        </button>
        {games.map((game) => (
          <button
            key={game.id}
            className={gameId === game.id ? "selected" : ""}
            onClick={() => setGameId(game.id)}
          >
            {game.name}
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="surface-panel leaderboard">
          <div className="leaderboard-head">
            <span>RANK</span>
            <span>MODEL</span>
            <span>GAMES</span>
            <span>WIN RATE</span>
            <span>RATING</span>
            <span>UPDATED</span>
          </div>
          {shown.map((entry, index) => (
            <div
              className="leaderboard-row"
              key={`${entry.gameId}:${entry.profileId}`}
            >
              <span className={`rank-number rank-${index + 1}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="model-ident">
                <div className="model-avatar">
                  {entry.profileName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{entry.profileName}</strong>
                  <span>
                    {entry.gameName} · {entry.profileId.slice(0, 8)}
                  </span>
                </div>
              </div>
              <span>{entry.games}</span>
              <span>
                {Math.round((entry.wins / Math.max(1, entry.games)) * 100)}%
              </span>
              <strong className="elo-value">{Math.round(entry.rating)}</strong>
              <span className="updated-cell">
                {formatDate(entry.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="surface-panel">
          <EmptyBlock
            icon={<Trophy size={20} />}
            title="暂无评分样本"
            body="完成一场有明确阵营结果的对局后，会为每个参赛模型生成独立评分。"
          />
        </div>
      )}
    </>
  );
}

function ModelsPage({
  profiles,
  onChanged,
  onNotify,
  editorOpen,
  setEditorOpen,
}: {
  profiles: ModelProfileSummary[];
  onChanged: () => Promise<void>;
  onNotify: (kind: "error" | "success", text: string) => void;
  editorOpen: boolean;
  setEditorOpen: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<ModelProfile | null>(null);
  const [checking, setChecking] = useState(false);
  const [modelList, setModelList] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const openNew = () => {
    setEditing(initialProfile());
    setModelList([]);
    setStatus("");
    setEditorOpen(true);
  };
  const edit = (profile: ModelProfileSummary) => {
    setEditing({ ...profile, apiKey: "" });
    setModelList([]);
    setStatus(profile.hasApiKey ? "凭据已保存。留空表示沿用已保存凭据。" : "");
    setEditorOpen(true);
  };
  useEffect(() => {
    if (editorOpen && !editing) setEditing(initialProfile());
  }, [editorOpen]);
  const update = (key: keyof ModelProfile, value: string) =>
    setEditing((current) => (current ? { ...current, [key]: value } : current));
  const test = async () => {
    if (!editing) return;
    setChecking(true);
    setStatus("正在验证 API…");
    try {
      const result = await window.arena.testProfile(editing);
      setStatus(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };
  const fetchModels = async () => {
    if (!editing) return;
    setChecking(true);
    setStatus("正在读取模型 ID…");
    try {
      const models = await window.arena.listModels(editing);
      setModelList(models);
      setStatus(`${models.length} 个模型可用`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };
  const save = async () => {
    if (!editing) return;
    try {
      const saved = await window.arena.saveProfile(editing);
      setEditing(null);
      setEditorOpen(false);
      await onChanged();
      onNotify("success", `${saved.length} 个模型档案已同步到本机`);
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : String(error));
    }
  };
  const remove = async (profile: ModelProfileSummary) => {
    if (!window.confirm(`删除模型配置“${profile.name}”？`)) return;
    try {
      await window.arena.deleteProfile(profile.id);
      await onChanged();
      onNotify("success", "模型配置已删除");
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="MODEL CONNECTIONS"
        title="模型接入"
        subtitle="一个统一连接档案可以分配给多个座位。密钥由 Electron 主进程加密保存。"
        action={
          <button className="button primary" onClick={openNew}>
            <Plus size={16} />
            添加模型
          </button>
        }
      />
      <div className="model-page-grid">
        <div className="model-list-area">
          <div className="list-toolbar">
            <span>{profiles.length} 个档案</span>
            <span>OpenAI-compatible Chat Completions</span>
          </div>
          {profiles.length ? (
            <div className="model-card-list">
              {profiles.map((profile) => (
                <div className="model-card" key={profile.id}>
                  <div className="model-provider-mark">
                    {profile.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="model-card-main">
                    <div className="model-card-title">
                      <strong>{profile.name}</strong>
                      <span className="connection-indicator">
                        <span />
                        {profile.hasApiKey ? "凭据已加密" : "缺少凭据"}
                      </span>
                    </div>
                    <div className="model-card-model">{profile.model}</div>
                    <div className="model-card-url">{profile.baseUrl}</div>
                  </div>
                  <div className="model-card-actions">
                    <button
                      className="button ghost small"
                      onClick={() => edit(profile)}
                    >
                      编辑
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => void remove(profile)}
                      title="删除"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="surface-panel">
              <EmptyBlock
                icon={<KeyRound size={19} />}
                title="连接第一个模型"
                body="添加 API Base URL、模型 ID 和凭据，然后测试连接。"
                action={
                  <button className="button secondary small" onClick={openNew}>
                    添加模型 <Plus size={14} />
                  </button>
                }
              />
            </div>
          )}
          <div className="security-note">
            <Shield size={17} />
            <div>
              <strong>本地凭据保护</strong>
              <p>
                API Key
                仅交给所选模型服务商；密钥在主进程通过系统安全存储加密，不进入渲染进程返回值、公开对局事件或回放。
              </p>
            </div>
          </div>
        </div>
        <aside className="provider-aside">
          <div className="aside-title">
            <span className="eyebrow">SUPPORTED CONNECTIONS</span>
            <h3>
              一个字段协议
              <br />
              多个模型来源
            </h3>
          </div>
          {presets.map((preset, index) => (
            <div className="provider-row" key={preset.name}>
              <div className={`provider-symbol provider-${index}`}>
                {index === 0 ? "O" : index === 1 ? "G" : "↗"}
              </div>
              <div>
                <strong>{preset.name}</strong>
                <span>{preset.baseUrl || "自定义兼容 API 地址"}</span>
              </div>
              <Check size={15} />
            </div>
          ))}
          <div className="provider-footnote">
            只发送 API
            必需字段与当前座位上下文。推理参数由供应商默认值处理，不做统一温度调节。
          </div>
        </aside>
      </div>
      {editorOpen && editing && (
        <div
          className="modal-scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditorOpen(false);
              setEditing(null);
            }
          }}
        >
          <section className="modal model-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">MODEL PROFILE</span>
                <h2>
                  {profiles.some((profile) => profile.id === editing.id)
                    ? "编辑连接"
                    : "新建模型连接"}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => {
                  setEditorOpen(false);
                  setEditing(null);
                }}
              >
                <X size={17} />
              </button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>显示名称</span>
                <input
                  value={editing.name}
                  placeholder="例如 GPT-4.1 Research"
                  onChange={(event) => update("name", event.target.value)}
                />
              </label>
              <label className="field">
                <span>服务商</span>
                <select
                  value={
                    presets.find((item) => item.baseUrl === editing.baseUrl)
                      ?.name ?? "OpenAI-compatible"
                  }
                  onChange={(event) => {
                    const preset = presets.find(
                      (item) => item.name === event.target.value,
                    );
                    if (preset?.baseUrl) update("baseUrl", preset.baseUrl);
                  }}
                >
                  <option>OpenAI</option>
                  <option>Gemini</option>
                  <option>OpenAI-compatible</option>
                </select>
              </label>
              <label className="field">
                <span>API Base URL</span>
                <input
                  value={editing.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => update("baseUrl", event.target.value)}
                />
              </label>
              <label className="field">
                <span>Model ID</span>
                <div className="field-action">
                  <input
                    list="available-model-ids"
                    value={editing.model}
                    placeholder="例如 gpt-4.1-mini"
                    onChange={(event) => update("model", event.target.value)}
                  />
                  <datalist id="available-model-ids">
                    {modelList.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  <button
                    className="button secondary small"
                    disabled={checking}
                    onClick={() => void fetchModels()}
                  >
                    <RefreshCw size={13} className={checking ? "spin" : ""} />
                    拉取 ID
                  </button>
                </div>
              </label>
              <label className="field">
                <span>
                  API Key{" "}
                  <small>
                    {profiles.some((profile) => profile.id === editing.id)
                      ? "留空沿用已保存密钥"
                      : "密钥加密保存在本机"}
                  </small>
                </span>
                <input
                  type="password"
                  value={editing.apiKey}
                  autoComplete="new-password"
                  placeholder={
                    profiles.some((profile) => profile.id === editing.id)
                      ? "已保存 · 输入新值以替换"
                      : "粘贴 API Key"
                  }
                  onChange={(event) => update("apiKey", event.target.value)}
                />
              </label>
              {status && (
                <div
                  className={`inline-status ${status.toLowerCase().includes("http") || status.toLowerCase().includes("failed") || status.includes("错误") ? "error" : ""}`}
                >
                  {checking && <LoaderCircle size={14} className="spin" />}
                  {status}
                </div>
              )}
              <div className="compat-info">
                <Sparkles size={15} />
                <span>
                  需要支持 Chat Completions 和 tool
                  calling。模型上下文按座位隔离；不同模型不共享历史。
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button ghost"
                onClick={() => {
                  setEditorOpen(false);
                  setEditing(null);
                }}
              >
                取消
              </button>
              <button
                className="button secondary"
                onClick={() => void test()}
                disabled={checking}
              >
                <Radio size={14} />
                测试连接
              </button>
              <button className="button primary" onClick={() => void save()}>
                <Check size={15} />
                保存档案
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function SetupPage({
  games,
  profiles,
  onBack,
  onStart,
  onAddModel,
}: {
  games: GameDescriptor[];
  profiles: ModelProfileSummary[];
  onBack: () => void;
  onStart: (input: CreateMatchInput) => void;
  onAddModel: () => void;
}) {
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [seatCount, setSeatCount] = useState(6);
  const [gameConfig, setGameConfig] = useState<Record<string, unknown>>({});
  const [seats, setSeats] = useState<SeatConfig[]>([]);
  useEffect(() => {
    setSeats((current) =>
      Array.from(
        { length: seatCount },
        (_, index) =>
          current[index] ??
          (profiles.length
            ? {
                id: crypto.randomUUID(),
                kind: "model" as const,
                profileId: profiles[index % profiles.length].id,
                name: `Seat ${String(index + 1).padStart(2, "0")}`,
              }
            : {
                id: crypto.randomUUID(),
                kind: "human" as const,
                name: `Player ${String(index + 1).padStart(2, "0")}`,
              }),
      ),
    );
  }, [seatCount, profiles]);
  const game = games.find((entry) => entry.id === gameId);
  useEffect(() => {
    if (!game) return;
    setGameConfig(
      Object.fromEntries(
        game.configFields.map((field) => [field.key, field.defaultValue]),
      ),
    );
  }, [game?.id]);
  const setGameField = (key: string, value: string | number) =>
    setGameConfig((current) => ({ ...current, [key]: value }));
  const updateSeat = (index: number, patch: Partial<SeatConfig>) =>
    setSeats((current) =>
      current.map((seat, seatIndex) =>
        seatIndex === index ? ({ ...seat, ...patch } as SeatConfig) : seat,
      ),
    );
  const modelSlots = seats.filter((seat) => seat.kind === "model").length;
  const canStart = Boolean(
    game &&
    seats.length >= game.minSeats &&
    seats.length <= game.maxSeats &&
    modelSlots >= 2 &&
    modelSlots + seats.filter((seat) => seat.kind === "human").length >=
      game.minSeats,
  );
  return (
    <>
      <PageHeading
        eyebrow="NEW MATCH"
        title="组建阵容"
        subtitle="选择游戏模块、参赛模型和真人座位；规则引擎负责裁定全部行动。"
        action={
          <button className="button ghost" onClick={onBack}>
            <ArrowLeft size={15} />
            返回
          </button>
        }
      />
      <div className="setup-layout">
        <div className="setup-main">
          <section className="surface-panel setup-section">
            <div className="setup-section-title">
              <div className="step-number">01</div>
              <div>
                <h2>选择游戏</h2>
                <p>已注册的游戏模块通过统一生命周期和 MCP 工具接入。</p>
              </div>
            </div>
            <div className="game-choice-list">
              {games.map((entry) => (
                <button
                  key={entry.id}
                  className={`game-choice ${gameId === entry.id ? "selected" : ""}`}
                  onClick={() => setGameId(entry.id)}
                >
                  <span className="choice-check">
                    {gameId === entry.id && <Check size={13} />}
                  </span>
                  <span className="game-choice-icon">
                    <Gamepad2 size={17} />
                  </span>
                  <span className="choice-copy">
                    <strong>{entry.name}</strong>
                    <small>{entry.description}</small>
                  </span>
                  <span className="tool-count">{entry.mcpToolCount} tools</span>
                </button>
              ))}
            </div>
          </section>
          <section className="surface-panel setup-section">
            <div className="setup-section-title">
              <div className="step-number">02</div>
              <div>
                <h2>参赛席位</h2>
                <p>
                  每个模型座位有独立上下文；真人座位在轮到时通过本地 UI 行动。
                </p>
              </div>
              <div className="seat-count-picker">
                <span>座位数</span>
                <select
                  value={seatCount}
                  onChange={(event) => setSeatCount(Number(event.target.value))}
                >
                  {Array.from({ length: 7 }, (_, index) => index + 4).map(
                    (count) => (
                      <option key={count}>{count}</option>
                    ),
                  )}
                </select>
              </div>
            </div>
            {!profiles.length && (
              <div className="inline-callout">
                <KeyRound size={15} />
                <span>
                  还没有模型档案。至少需要两个模型座位，才能开始 AI 对战。
                </span>
                <button className="text-button" onClick={onAddModel}>
                  添加模型 <ArrowRight size={13} />
                </button>
              </div>
            )}
            <div className="seat-editor">
              {seats.map((seat, index) => (
                <SeatEditor
                  key={seat.id}
                  index={index}
                  seat={seat}
                  profiles={profiles}
                  onChange={(patch) => updateSeat(index, patch)}
                />
              ))}
            </div>
          </section>
        </div>
        <aside className="setup-side">
          <section className="surface-panel rules-panel">
            <div className="setup-section-title">
              <div className="step-number">03</div>
              <div>
                <h2>游戏配置</h2>
                <p>{game?.name ?? "选择一个游戏模块"}</p>
              </div>
            </div>
            {game?.configFields.map((field) => (
              <label className="field" key={field.key}>
                <span>{field.label}</span>
                {field.type === "select" ? (
                  <select
                    value={String(gameConfig[field.key] ?? field.defaultValue)}
                    onChange={(event) =>
                      setGameField(
                        field.key,
                        typeof field.defaultValue === "number"
                          ? Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  >
                    {field.options?.map((option) => (
                      <option key={String(option.value)} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={field.minimum}
                    max={
                      field.key === "undercoverCount"
                        ? Math.min(
                            field.maximum ?? seatCount,
                            Math.floor((seatCount - 1) / 2),
                          )
                        : field.maximum
                    }
                    step={field.step ?? 1}
                    value={Number(gameConfig[field.key] ?? field.defaultValue)}
                    onChange={(event) =>
                      setGameField(field.key, Number(event.target.value))
                    }
                  />
                )}
              </label>
            ))}
            <div className="rules-summary">
              <div>
                <span>游戏工具</span>
                <strong>{game?.mcpToolCount ?? 0}</strong>
              </div>
              <div>
                <span>模型座位</span>
                <strong>{modelSlots}</strong>
              </div>
              <div>
                <span>真人座位</span>
                <strong>{seats.length - modelSlots}</strong>
              </div>
            </div>
            <div className="elo-notice">
              <Trophy size={15} />
              <p>
                完成对局后更新本游戏的
                team-Elo。真人座位参与赛果，不计入模型榜。
              </p>
            </div>
            <button
              className="button primary full"
              disabled={!canStart}
              onClick={() => onStart({ gameId, seats, config: gameConfig })}
            >
              <Gamepad2 size={16} />
              创建并开赛
            </button>
            <div className="setup-privacy">
              <Shield size={13} />
              身份和词语只按座位下发
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function SeatEditor({
  index,
  seat,
  profiles,
  onChange,
}: {
  index: number;
  seat: SeatConfig;
  profiles: ModelProfileSummary[];
  onChange: (patch: Partial<SeatConfig>) => void;
}) {
  const profile =
    seat.kind === "model"
      ? profiles.find((entry) => entry.id === seat.profileId)
      : undefined;
  return (
    <div className="seat-editor-row">
      <span className="seat-index">{String(index + 1).padStart(2, "0")}</span>
      <div className={`seat-kind-icon ${seat.kind}`}>
        {seat.kind === "human" ? <Users size={15} /> : <Bot size={15} />}
      </div>
      <select
        className="seat-type-select"
        value={seat.kind}
        onChange={(event) =>
          event.target.value === "human"
            ? onChange({
                kind: "human",
                name: `Player ${String(index + 1).padStart(2, "0")}`,
              })
            : onChange({
                kind: "model",
                profileId: profiles[0]?.id ?? "",
                name: `Seat ${String(index + 1).padStart(2, "0")}`,
              })
        }
      >
        <option value="model">AI 模型</option>
        <option value="human">真人玩家</option>
      </select>
      {seat.kind === "model" ? (
        <select
          className="seat-profile-select"
          value={seat.profileId}
          onChange={(event) => onChange({ profileId: event.target.value })}
        >
          {profiles.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} · {entry.model}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="seat-name-input"
          value={seat.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="玩家名称"
        />
      )}
      {seat.kind === "model" && (
        <span className="seat-context">
          <Shield size={12} />
          独立上下文
        </span>
      )}
      {seat.kind === "human" && <span className="human-badge">本地行动</span>}
    </div>
  );
}

function MatchPage({
  snapshot,
  onBack,
  onRetry,
  onHumanAction,
  onReplay,
}: {
  snapshot: GameSnapshot;
  onBack: () => void;
  onRetry: () => void;
  onHumanAction: (
    seatId: string,
    tool: string,
    args: Record<string, unknown>,
  ) => void;
  onReplay: () => void;
}) {
  const activeSeat = snapshot.seats.find(
    (seat) => seat.id === snapshot.currentSeatId,
  );
  const [observation, setObservation] = useState<PrivateObservation | null>(
    null,
  );
  const [revealed, setRevealed] = useState(false);
  const [actionValues, setActionValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<"events" | "seats">("events");

  useEffect(() => {
    setObservation(null);
    setRevealed(false);
    setActionValues({});
    if (snapshot.status === "waiting-human" && activeSeat?.kind === "human") {
      void window.arena
        .getHumanObservation(snapshot.matchId, activeSeat.id)
        .then(setObservation)
        .catch(() => setObservation(null));
    }
  }, [snapshot.matchId, snapshot.currentSeatId, snapshot.status]);

  const submit = async (tool: string, args: Record<string, unknown>) => {
    if (!activeSeat) return;
    setSubmitting(true);
    try {
      await onHumanAction(activeSeat.id, tool, args);
      setObservation(null);
      setRevealed(false);
    } finally {
      setSubmitting(false);
    }
  };
  const sortedEvents = [...snapshot.events].reverse();
  return (
    <>
      <PageHeading
        eyebrow={`MATCH · ${snapshot.matchId.slice(0, 8).toUpperCase()}`}
        title={snapshot.gameName}
        subtitle={`${snapshot.phaseLabel} · 第 ${snapshot.round}/${snapshot.maxRounds} 轮`}
        action={
          <button className="button ghost" onClick={onBack}>
            <ArrowLeft size={15} />
            所有对局
          </button>
        }
      />
      <div className="match-live-layout">
        <div className="live-main">
          <div className="live-banner">
            <div className="live-banner-copy">
              <span className={`live-indicator ${snapshot.status}`}>
                <span />
                {statusMeta(snapshot.status).label}
              </span>
              <strong>
                {snapshot.status === "waiting-human"
                  ? `等待 ${snapshot.currentSeatName} 行动`
                  : snapshot.status === "running"
                    ? "智能体正在行动"
                    : snapshot.status === "paused"
                      ? "对局已暂停"
                      : (snapshot.outcome ?? "对局已创建")}
              </strong>
              <span>
                Round {snapshot.round} <i /> {snapshot.phaseLabel}
              </span>
            </div>
            <div className="live-banner-actions">
              {snapshot.status === "paused" && (
                <button className="button secondary" onClick={onRetry}>
                  <RefreshCw size={14} />
                  重试行动
                </button>
              )}
              {snapshot.status === "finished" && (
                <button className="button secondary" onClick={onReplay}>
                  <FileClock size={14} />
                  查看回放
                </button>
              )}
            </div>
          </div>
          {snapshot.error && (
            <div className="error-banner">
              <CircleHelp size={16} />
              <span>{snapshot.error}</span>
            </div>
          )}
          {snapshot.status === "waiting-human" &&
            activeSeat?.kind === "human" && (
              <HumanActionCard
                snapshot={snapshot}
                observation={observation}
                revealed={revealed}
                setRevealed={setRevealed}
                values={actionValues}
                setValues={setActionValues}
                submitting={submitting}
                onSubmit={submit}
              />
            )}
          <section className="surface-panel live-board">
            <div className="panel-heading">
              <div>
                <h2>公共状态</h2>
                <p>所有座位共享的游戏信息 · 私密身份仅在回放揭示</p>
              </div>
              <span className="round-chip">
                ROUND {String(snapshot.round).padStart(2, "0")}
              </span>
            </div>
            <div className="seat-board">
              {snapshot.seats.map((seat, index) => (
                <div
                  className={`board-seat ${!seat.alive ? "eliminated" : ""} ${seat.id === snapshot.currentSeatId ? "acting" : ""}`}
                  key={seat.id}
                >
                  <div className="board-seat-top">
                    <span className="board-seat-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={`board-seat-type ${seat.kind}`}>
                      {seat.kind === "human" ? (
                        <Users size={13} />
                      ) : (
                        <Bot size={13} />
                      )}
                    </span>
                    {seat.id === snapshot.currentSeatId && (
                      <span className="turn-pip" />
                    )}
                  </div>
                  <strong>{seat.name}</strong>
                  <span className="board-seat-sub">
                    {seat.alive
                      ? seat.kind === "human"
                        ? "真人座位"
                        : "AI 座位"
                      : "已淘汰"}
                  </span>
                  <div className="seat-clue">
                    {seat.clue ? (
                      <>
                        <span>线索</span>
                        <p>{seat.clue}</p>
                      </>
                    ) : (
                      <span className="muted">等待线索</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="surface-panel event-panel">
            <div className="panel-heading">
              <div>
                <h2>比赛时间线</h2>
                <p>{snapshot.events.length} 个记录事件</p>
              </div>
              <div className="event-tabs">
                <button
                  className={tab === "events" ? "active" : ""}
                  onClick={() => setTab("events")}
                >
                  全部
                </button>
                <button
                  className={tab === "seats" ? "active" : ""}
                  onClick={() => setTab("seats")}
                >
                  参赛席位
                </button>
              </div>
            </div>
            {tab === "events" ? (
              <div className="timeline">
                {sortedEvents.slice(0, 18).map((event) => (
                  <div className={`timeline-item ${event.kind}`} key={event.id}>
                    <div className="timeline-node" />
                    <div className="timeline-copy">
                      <span>
                        R{String(event.round).padStart(2, "0")} ·{" "}
                        {new Date(event.time).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <p>{event.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="seat-list">
                {snapshot.seats.map((seat) => (
                  <div key={seat.id}>
                    <span className={`seat-small-icon ${seat.kind}`}>
                      {seat.kind === "human" ? (
                        <Users size={14} />
                      ) : (
                        <Bot size={14} />
                      )}
                    </span>
                    <strong>{seat.name}</strong>
                    <span>
                      {seat.kind === "human" ? "真人参与" : "AI 模型"} ·
                      独立上下文
                    </span>
                    <span className={seat.alive ? "alive-state" : "dead-state"}>
                      {seat.alive ? "存活" : "淘汰"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="live-side">
          <section className="surface-panel live-side-card">
            <span className="eyebrow">MATCH CONFIG</span>
            <h3>对局参数</h3>
            <div className="config-line">
              <span>游戏</span>
              <strong>{snapshot.gameName}</strong>
            </div>
            <div className="config-line">
              <span>比赛 ID</span>
              <strong className="mono">{snapshot.matchId.slice(0, 12)}</strong>
            </div>
            <div className="config-line">
              <span>最大轮数</span>
              <strong>{snapshot.maxRounds}</strong>
            </div>
            <div className="config-line">
              <span>参赛席位</span>
              <strong>{snapshot.seats.length}</strong>
            </div>
            <div className="config-line">
              <span>MCP 游戏工具</span>
              <strong>4</strong>
            </div>
          </section>
          <section className="surface-panel live-side-card privacy-card">
            <div className="privacy-icon">
              <Shield size={17} />
            </div>
            <h3>隔离上下文</h3>
            <p>
              每个 AI
              座位维护独立消息历史。模型只会收到自己的私有观察和游戏公开区。
            </p>
            <div className="privacy-check">
              <Check size={13} />
              调用统一 MCP 工具
            </div>
            <div className="privacy-check">
              <Check size={13} />
              模型之间不共享历史
            </div>
          </section>
          <section className="surface-panel live-side-card elo-card">
            <span className="eyebrow">TEAM ELO</span>
            <h3>评分方式</h3>
            <p>
              按游戏分别评分，使用阵营平均分估算赛前胜率；真人座位不计入模型排名。
            </p>
            <button
              className="text-button"
              onClick={onReplay}
              disabled={snapshot.status !== "finished"}
            >
              赛后查看分数变化 <ArrowRight size={13} />
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}

function HumanActionCard({
  snapshot,
  observation,
  revealed,
  setRevealed,
  values,
  setValues,
  submitting,
  onSubmit,
}: {
  snapshot: GameSnapshot;
  observation: PrivateObservation | null;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
  values: Record<string, string>;
  setValues: (value: Record<string, string>) => void;
  submitting: boolean;
  onSubmit: (tool: string, args: Record<string, unknown>) => void;
}) {
  const action = snapshot.humanActions?.[0]
  const args = Object.fromEntries((action?.fields ?? []).map((field) => [field.key, values[field.key] ?? '']))
  const ready = Boolean(action && action.fields.every((field) => !field.required || String(args[field.key]).trim()))
  return (
    <section className="human-turn-panel">
      <div className="human-turn-title">
        <div className="human-turn-icon">
          <Users size={17} />
        </div>
        <div>
          <span className="eyebrow">
            HUMAN TURN · {snapshot.currentSeatName}
          </span>
          <h2>轮到你行动</h2>
        </div>
        <span className="private-badge">
          <Shield size={12} />
          仅当前座位
        </span>
      </div>
      {!revealed ? (
        <div className="reveal-row">
          <p>这是你的私有信息。确认当前操作设备由你使用后再查看。</p>
          <button
            className="button secondary"
            disabled={!observation}
            onClick={() => setRevealed(true)}
          >
            <Eye size={14} />
            {observation ? "查看我的身份" : "正在载入私有区"}
          </button>
        </div>
      ) : (
        <div className="human-private">
          <div>
            <span>你的身份</span>
            <strong
              className={observation?.role === "卧底" ? "undercover-word" : ""}
            >
              {observation?.role}
            </strong>
          </div>
          <div>
            <span>你的词语</span>
            <strong>{observation?.word}</strong>
          </div>
          <button
            className="icon-button"
            onClick={() => setRevealed(false)}
            title="隐藏身份"
          >
            <EyeOff size={15} />
          </button>
        </div>
      )}
      {revealed && action && (
        <div className="human-action-form">
          {action.description && <p className="human-action-description">{action.description}</p>}
          {action.fields.map((field) => (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select value={values[field.key] ?? ''} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}>
                  <option value="">请选择</option>
                  {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input
                  maxLength={field.maxLength}
                  value={values[field.key] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Enter' && ready) onSubmit(action.tool, args) }}
                />
              )}
            </label>
          ))}
          <div className="form-footer">
            <span>行动由所选游戏模块校验</span>
            <button className="button primary small" disabled={!ready || submitting} onClick={() => onSubmit(action.tool, args)}>
              {submitting ? <LoaderCircle size={14} className="spin" /> : null}
              {action.label} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ReplayPage({
  replay,
  onBack,
}: {
  replay: ReplayData;
  onBack: () => void;
}) {
  const [seatId, setSeatId] = useState(replay.roles[0]?.seatId ?? "");
  const [roundFilter, setRoundFilter] = useState("all");
  const selected = replay.roles.find((role) => role.seatId === seatId);
  const observations = replay.privateObservations.filter(
    (entry) =>
      entry.seatId === seatId &&
      (roundFilter === "all" || entry.round === Number(roundFilter)),
  );
  const rounds = [
    ...new Set(
      replay.privateObservations
        .filter((entry) => entry.seatId === seatId)
        .map((entry) => entry.round),
    ),
  ];
  const deltaMap = new Map(
    replay.ratingChanges.map((change) => [change.profileId, change]),
  );
  return (
    <>
      <PageHeading
        eyebrow={`REPLAY · ${replay.snapshot.matchId.slice(0, 8).toUpperCase()}`}
        title="对局回放"
        subtitle={
          replay.snapshot.outcome ?? "查看比赛事件与每个座位的独立观察。"
        }
        action={
          <button className="button ghost" onClick={onBack}>
            <ArrowLeft size={15} />
            返回对局
          </button>
        }
      />
      <div className="replay-summary">
        <div className="replay-result-icon">
          <Trophy size={19} />
        </div>
        <div>
          <span className="eyebrow">FINAL RESULT</span>
          <strong>{replay.snapshot.outcome}</strong>
          <p>
            {replay.snapshot.seats.length} 个座位 · {replay.snapshot.round} 轮 ·
            完整上下文独立保存
          </p>
        </div>
        <span className="completed-chip">
          <Check size={13} />
          已完成
        </span>
      </div>
      <div className="replay-layout">
        <section className="surface-panel replay-events">
          <div className="panel-heading">
            <div>
              <h2>公开事件</h2>
              <p>按发生顺序记录的比赛时间线</p>
            </div>
          </div>
          <div className="timeline replay-timeline">
            {replay.snapshot.events.map((event) => (
              <div className={`timeline-item ${event.kind}`} key={event.id}>
                <div className="timeline-node" />
                <div className="timeline-copy">
                  <span>
                    ROUND {String(event.round).padStart(2, "0")} ·{" "}
                    {new Date(event.time).toLocaleString("zh-CN")}
                  </span>
                  <p>{event.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="surface-panel replay-private">
          <div className="panel-heading">
            <div>
              <h2>座位私有视图</h2>
              <p>该座位实际获得的信息，不共享给其他模型</p>
            </div>
            <Shield size={16} className="muted-icon" />
          </div>
          <div className="replay-selects">
            <label>
              <span>座位</span>
              <select
                value={seatId}
                onChange={(event) => {
                  setSeatId(event.target.value);
                  setRoundFilter("all");
                }}
              >
                {replay.roles.map((role) => (
                  <option key={role.seatId} value={role.seatId}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>轮次</span>
              <select
                value={roundFilter}
                onChange={(event) => setRoundFilter(event.target.value)}
              >
                <option value="all">全部轮次</option>
                {rounds.map((round) => (
                  <option key={round} value={round}>
                    第 {round} 轮
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selected && (
            <div className="role-reveal">
              <div>
                <span>身份</span>
                <strong
                  className={selected.role === "卧底" ? "undercover-word" : ""}
                >
                  {selected.role}
                </strong>
              </div>
              <div>
                <span>词语</span>
                <strong>{selected.word}</strong>
              </div>
              <span
                className={`alive-label ${selected.alive ? "alive-state" : "dead-state"}`}
              >
                {selected.alive ? "存活至终局" : "已被淘汰"}
              </span>
            </div>
          )}
          <div className="observation-stack">
            {observations.length ? (
              observations.map((entry, index) => (
                <div
                  className="observation-card"
                  key={`${entry.round}-${entry.phase}-${index}`}
                >
                  <div className="observation-head">
                    <span>
                      R{String(entry.round).padStart(2, "0")} ·{" "}
                      {entry.phase === "clue" ? "线索行动" : "投票行动"}
                    </span>
                    <span>OBSERVATION</span>
                  </div>
                  <div className="observation-own">
                    <span>私有角色</span>
                    <strong>
                      {entry.observation.role} · {entry.observation.word}
                    </strong>
                  </div>
                  <div className="observation-public">
                    <span>当时可见的公开区</span>
                    <div>
                      {(
                        entry.observation.publicState as GameSnapshot
                      ).seats.map((seat) => (
                        <div key={seat.id}>
                          <span>{seat.name}</span>
                          <strong>{seat.clue ?? "—"}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="no-observations">
                <EyeOff size={17} />
                <span>该座位没有记录到调用观察工具。</span>
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="surface-panel elo-change-panel">
        <div className="panel-heading">
          <div>
            <h2>Elo 变化</h2>
            <p>本场赛果对应的模型评分变动</p>
          </div>
          <span className="elo-k-chip">K = 32</span>
        </div>
        {replay.ratingChanges.length ? (
          <div className="elo-changes">
            {replay.ratingChanges.map((change, index) => (
              <div key={`${change.profileId}-${index}`}>
                <span className="elo-change-avatar">
                  {change.profileName.slice(0, 1)}
                </span>
                <strong>{change.profileName}</strong>
                <span className="elo-before">{Math.round(change.before)}</span>
                {change.delta >= 0 ? (
                  <ArrowUpRight size={15} className="positive" />
                ) : (
                  <ArrowDownRight size={15} className="negative" />
                )}
                <span className={change.delta >= 0 ? "positive" : "negative"}>
                  {ratingDelta(change)}
                </span>
                <strong className="elo-after">
                  {Math.round(change.after)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-rating-change">
            本局包含平局或没有模型座位，因此没有 Elo 变化。
          </div>
        )}
      </section>
    </>
  );
}
