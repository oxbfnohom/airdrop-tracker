"use client";

export type Tab = "today" | "news" | "oppo" | "settings";

/* ── ikon stroke 1.75 ala referensi ── */
function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const IconGarapan = () => (
  <Icon>
    <path d="M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
    <path d="M8.5 12l2 2 3.5-3.5" />
    <path d="M17 17l2 2 4-4" />
  </Icon>
);
const IconBerita = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7 8h6" />
    <path d="M7 12h10" />
    <path d="M7 16h10" />
  </Icon>
);
const IconPeluang = () => (
  <Icon>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </Icon>
);
const IconSetelan = () => (
  <Icon>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="15" cy="18" r="2" />
  </Icon>
);
const IconRefresh = () => (
  <Icon>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </Icon>
);

const TABS: Array<{ key: Tab; label: string; icon: () => React.JSX.Element }> = [
  { key: "today", label: "Garapan", icon: IconGarapan },
  { key: "news", label: "Berita", icon: IconBerita },
  { key: "oppo", label: "Peluang", icon: IconPeluang },
  { key: "settings", label: "Setelan", icon: IconSetelan },
];

function Brand() {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent font-black text-[#0c1500] shadow-[0_0_0_5px_rgba(0,200,5,0.12)]">AT</span>
  );
}

/** Shell navigasi: rail kiri (desktop) + top bar & bottom nav (mobile). */
export default function Header({
  tab,
  onTab,
  oppoCount,
  refreshing,
  onRefresh,
  statusLine,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  oppoCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  statusLine: string;
}) {
  return (
    <>
      {/* rail kiri — desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-bg px-3 py-5 md:flex" aria-label="Navigasi utama">
        <div className="flex items-center gap-2.5 px-2">
          <Brand />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold leading-tight">Airdrop Tracker</p>
            <p className="truncate text-[11px] leading-tight text-faint">{statusLine}</p>
          </div>
        </div>

        <nav className="mt-7 flex flex-col gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onTab(t.key)}
                className={`flex min-h-11 items-center gap-3 rounded-[13px] px-3 text-sm transition-colors ${
                  active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface hover:text-text"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={active ? "text-accent" : ""}>{t.icon()}</span>
                <span className="flex-1 text-left">{t.label}</span>
                {t.key === "oppo" && oppoCount > 0 && (
                  <span className="rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold text-[#0c1500]">{oppoCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto px-0">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex min-h-11 w-full items-center gap-3 rounded-[13px] px-3 text-sm text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-50"
          >
            <span className={refreshing ? "animate-spin" : ""}>
              <IconRefresh />
            </span>
            <span className="flex-1 text-left">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </aside>

      {/* top bar — mobile */}
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Brand />
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold leading-tight">Airdrop Tracker</p>
              <p className="truncate text-[11px] leading-tight text-faint">{statusLine}</p>
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex min-h-11 items-center justify-center rounded-[13px] border border-border px-3 text-muted transition-colors hover:bg-surface hover:text-text disabled:opacity-50"
            title="Refresh semua data"
          >
            <span className={refreshing ? "animate-spin" : ""}>
              <IconRefresh />
            </span>
          </button>
        </div>
      </header>

      {/* bottom nav — mobile, safe-area buat iPhone */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navigasi utama"
      >
        <div className="grid grid-cols-4">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => onTab(t.key)}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 transition-colors ${
                  active ? "text-accent" : "text-faint"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {t.icon()}
                <span className="text-[10px]">{t.label}</span>
                {t.key === "oppo" && oppoCount > 0 && (
                  <span className="absolute right-1/2 top-1.5 translate-x-5 rounded-full bg-warn px-1.5 text-[9px] font-bold text-[#0c1500]">
                    {oppoCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}