"use client";

import {
  Activity,
  Archive,
  BarChart3,
  ClipboardCheck,
  Gauge,
  History,
  LogOut,
  ShieldCheck,
  StickyNote,
  Table2,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const NAV_ITEMS: { href: string; label: string; icon: typeof Truck; roles: Role[] }[] = [
  { href: "/dashboard/new-pickup", label: "New Pickup", icon: Truck, roles: ["employee", "manager"] },
  { href: "/dashboard/carryover", label: "Carryover", icon: Timer, roles: ["employee", "manager"] },
  { href: "/dashboard/all-pickups", label: "All Pickups", icon: Table2, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/notes", label: "Notes", icon: StickyNote, roles: ["employee", "qc", "manager"] },
  { href: "/dashboard/my-history", label: "My History", icon: History, roles: ["employee", "manager"] },
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

  useEffect(() => {
    if (hasHydrated && !token) router.replace("/login");
  }, [hasHydrated, token, router]);

  // Keep the employee's performance score fresh as they navigate.
  useEffect(() => {
    if (!token || role !== "employee") return;
    api<User>("/api/users/me")
      .then((u) => setScore(u.performance_score))
      .catch(() => setScore(null));
  }, [token, role, pathname]);

  if (!hasHydrated || !token || !role) return null;

  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex">
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
        <nav className="flex-1 space-y-1 p-2" aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
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
              </Link>
            );
          })}
        </nav>
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
            {role === "employee" && score !== null && <ScoreBadge score={score} />}
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

        {/* Desktop top bar: employee performance score pinned top-right */}
        {role === "employee" && score !== null && (
          <div className="hidden justify-end px-6 pt-4 md:flex">
            <ScoreBadge score={score} />
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6 md:pt-3">{children}</main>
      </div>
    </div>
  );
}
