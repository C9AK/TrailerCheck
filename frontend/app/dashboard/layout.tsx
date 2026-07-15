"use client";

import {
  Activity,
  Archive,
  BarChart3,
  ClipboardCheck,
  FileClock,
  Gauge,
  History,
  LogOut,
  ShieldCheck,
  StickyNote,
  Table2,
  Timer,
  Trophy,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { AutoNote, Role, Ticket, User } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const FLAG_POLL_MS = 15_000;
const REMINDER_CHECK_MS = 5 * 60_000; // check every 5 min...
const REMINDER_EVERY_MS = 60 * 60_000; // ...but nag at most hourly

interface Toast {
  msg: string;
  tone: "alert" | "warn";
}

const NAV_ITEMS: { href: string; label: string; icon: typeof Truck; roles: Role[] }[] = [
  { href: "/dashboard/new-pickup", label: "New Pickup", icon: Truck, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/carryover", label: "Carryover", icon: Timer, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/all-pickups", label: "All Pickups", icon: Table2, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/notes", label: "Notes", icon: StickyNote, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/leaderboard", label: "Leaderboard", icon: Trophy, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/my-history", label: "My History", icon: History, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/qc-review", label: "QC Review", icon: ShieldCheck, roles: ["qc", "manager"] },
  { href: "/dashboard/qc-history", label: "My Audits", icon: ClipboardCheck, roles: ["qc", "manager"] },
  { href: "/dashboard/manager/live-feed", label: "Live Feed", icon: Activity, roles: ["manager"] },
  { href: "/dashboard/manager/archive", label: "Archive", icon: Archive, roles: ["manager"] },
  { href: "/dashboard/manager/stats", label: "Stats", icon: BarChart3, roles: ["manager"] },
  { href: "/dashboard/admin", label: "Admin", icon: Users, roles: ["manager"] },
];

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score < 70
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
      : score < 100
        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  return (
    <span
      title="Your performance score"
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm font-semibold ${tone}`}
    >
      <Gauge className="h-4 w-4" aria-hidden="true" />
      {score}
    </span>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { token, role, username, hasHydrated, logout } = useAuthStore();
  const [score, setScore] = useState<number | null>(null);

  // R8: flag notifications — poll the Action Required queue, badge the nav,
  // and toast the creator the moment QC flags one of THEIR tickets.
  const [flagCount, setFlagCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  // R17 "Still Sending": the dispatcher's parked drafts, one click to resume
  const [drafts, setDrafts] = useState<Ticket[]>([]);
  const knownFlagIds = useRef<Set<string> | null>(null);
  // R13: QC gets notified when a flagged pickup comes back RESOLVED
  const knownResolvedIds = useRef<Set<string> | null>(null);

  // R14: the API client fires this event while retrying against a sleeping
  // Render instance — surface it through the existing toast UI.
  useEffect(() => {
    const onToast = (e: Event) => setToast((e as CustomEvent<Toast>).detail);
    window.addEventListener("tc-toast", onToast);
    return () => window.removeEventListener("tc-toast", onToast);
  }, []);

  useEffect(() => {
    // R14: QC creates pickups too — they get the same flag notifications.
    if (!token || !role) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const flaggedTickets = await api<Ticket[]>("/api/tickets/flagged");
        if (cancelled) return;
        setFlagCount(flaggedTickets.length);
        const ids = new Set(flaggedTickets.map((t) => t.id));
        if (knownFlagIds.current !== null) {
          const fresh = flaggedTickets.filter((t) => !knownFlagIds.current!.has(t.id));
          const mine = fresh.find((t) => t.creator.username === username);
          const urgent = fresh.find((t) => t.is_urgent_flag);
          if (mine) {
            setToast({
              msg: `QC flagged your ticket for truck ${mine.truck_number} — see Action Required.`,
              tone: "alert",
            });
          } else if (urgent && role !== "manager") {
            setToast({
              msg: `URGENT flag on truck ${urgent.truck_number} — anyone available can fix it.`,
              tone: "alert",
            });
          }
        }
        knownFlagIds.current = ids;
      } catch {
        /* transient — keep last known state */
      }
    };
    poll();
    const id = setInterval(poll, FLAG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, role, username]);

  // R13: QC (and managers) — toast when an employee resends a flagged pickup
  useEffect(() => {
    if (!token || (role !== "qc" && role !== "manager")) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const queue = await api<Ticket[]>("/api/tickets/qc");
        if (cancelled) return;
        const resolved = queue.filter((t) => t.state === "RESOLVED");
        const ids = new Set(resolved.map((t) => t.id));
        if (knownResolvedIds.current !== null) {
          const fresh = resolved.filter((t) => !knownResolvedIds.current!.has(t.id));
          if (fresh.length > 0) {
            const first = fresh[0];
            setToast({
              msg:
                `${first.creator.username} resent truck ${first.truck_number} after fixes — ready to verify` +
                (fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "") +
                ".",
              tone: "alert",
            });
          }
        }
        knownResolvedIds.current = ids;
      } catch {
        /* transient — keep last known state */
      }
    };
    poll();
    const id = setInterval(poll, FLAG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, role]);

  // R13: hourly reminder for employees (and QC since R14) — missing items on
  // their carryover tickets (the shift-notes auto-compiler is the source of truth).
  useEffect(() => {
    if (!token || (role !== "employee" && role !== "qc")) return;
    const storageKey = `tc-missing-reminder-${username}`;
    let cancelled = false;
    const check = async () => {
      try {
        const last = Number(localStorage.getItem(storageKey) || 0);
        if (Date.now() - last < REMINDER_EVERY_MS) return;
        const drafts = await api<{ auto_notes: AutoNote[] }>("/api/notes/drafts");
        if (cancelled || drafts.auto_notes.length === 0) return;
        const first = drafts.auto_notes[0];
        setToast({
          msg:
            `Hourly check: ${drafts.auto_notes.length} item(s) still missing on your ` +
            `carryover tickets — e.g. ${first.content}. Recheck them before handover.`,
          tone: "warn",
        });
        localStorage.setItem(storageKey, String(Date.now()));
      } catch {
        /* transient */
      }
    };
    check();
    const id = setInterval(check, REMINDER_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, role, username]);

  // R17: keep the Active Drafts panel fresh (poll + refetch on navigation,
  // so a just-saved draft appears the moment the form redirects away).
  useEffect(() => {
    if (!token || !role) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const d = await api<Ticket[]>("/api/tickets/drafts");
        if (!cancelled) setDrafts(d);
      } catch {
        /* transient — keep last known state */
      }
    };
    poll();
    const id = setInterval(poll, FLAG_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, role, pathname]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 12_000);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (hasHydrated && !token) router.replace("/login");
  }, [hasHydrated, token, router]);

  // Keep the employee's (or QC creator's, R14) performance score fresh.
  useEffect(() => {
    if (!token || (role !== "employee" && role !== "qc")) return;
    api<User>("/api/users/me")
      .then((u) => setScore(u.performance_score))
      .catch(() => setScore(null));
  }, [token, role, pathname]);

  if (!hasHydrated || !token || !role) return null;

  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));

  return (
    <div className="flex min-h-dvh">
      {/* Sticky sidebar: stays pinned to the viewport while the page scrolls,
          so the logout footer is always visible; the nav list scrolls
          internally if it ever outgrows the screen. */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="flex items-center justify-center border-b border-blue-100 px-4 py-3 dark:border-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="UGL Trailer Check"
            width={210}
            height={140}
            className="h-28 w-auto"
          />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            const showBadge = href === "/dashboard/carryover" && flagCount > 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                  active
                    ? "bg-blue-800 text-white"
                    : "text-slate-700 hover:bg-blue-50 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {showBadge && (
                  <span
                    className="ml-auto flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-600 px-1.5 font-mono text-xs font-bold text-white"
                    title={`${flagCount} flagged ticket(s) need action`}
                  >
                    {flagCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* R17 Active Drafts — parked "Still Sending" pickups, click to resume */}
        {drafts.length > 0 && (
          <div className="border-t border-blue-100 p-2 dark:border-slate-800">
            <p className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400">
              <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
              Active Drafts ({drafts.length})
            </p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {drafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={`Resume draft for truck ${d.truck_number} (${d.motor_carrier.name})`}
                  onClick={() => router.push(`/dashboard/new-pickup?edit=${d.id}`)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-left text-xs font-medium text-sky-900 transition-colors duration-150 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-950/70"
                >
                  <span className="truncate font-mono font-semibold">{d.truck_number}</span>
                  <span className="truncate text-[10px] text-sky-600 dark:text-sky-400">
                    {d.motor_carrier.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-blue-100 p-3 dark:border-slate-800">
          <p className="mb-2 truncate text-xs text-slate-500 dark:text-slate-400">
            {username} · <span className="font-mono uppercase">{role}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-slate-700 transition-colors duration-150 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center gap-1 overflow-x-auto border-b border-blue-100 bg-white px-2 py-2 dark:border-slate-800 dark:bg-slate-900 md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="UGL Trailer Check"
            width={72}
            height={48}
            className="h-12 w-auto shrink-0"
          />
          {items.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded px-3 py-2 text-sm font-medium ${
                pathname === href
                  ? "bg-blue-800 text-white"
                  : "text-slate-700 dark:text-slate-300"
              }`}
            >
              {label}
            </Link>
          ))}
          <span className="ml-auto flex items-center gap-1">
            {(role === "employee" || role === "qc") && score !== null && (
              <ScoreBadge score={score} />
            )}
            <button
              type="button"
              aria-label="Log out"
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="cursor-pointer rounded p-2 text-slate-600 dark:text-slate-300"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        </header>

        {/* Desktop top bar: employee/QC performance score pinned top-right */}
        {(role === "employee" || role === "qc") && score !== null && (
          <div className="hidden justify-end px-6 pt-4 md:flex">
            <ScoreBadge score={score} />
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6 md:pt-3">{children}</main>

        {/* Floating bottom-right notification (alerts red, reminders amber) */}
        {toast && (
          <div
            role="alert"
            aria-live="assertive"
            className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border-2 bg-white p-3 text-sm font-medium shadow-xl dark:bg-slate-900 ${
              toast.tone === "warn" ? "border-amber-500" : "border-red-500"
            }`}
          >
            <span
              className={`mt-0.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full ${
                toast.tone === "warn" ? "bg-amber-500" : "bg-red-600"
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0">{toast.msg}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
              className="ml-1 shrink-0 cursor-pointer text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
