"use client";

import { BookOpen, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import GuardedLink from "@/components/GuardedLink";
import RequireRole from "@/components/RequireRole";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { GuideSummary } from "@/lib/types";

export default function GuidesPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <Guides />
    </RequireRole>
  );
}

function Guides() {
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // R53: the backend returns only the handbooks this role may open — an
    // employee simply never sees the QC book listed.
    api<GuideSummary[]>("/api/guides")
      .then(setGuides)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load the guides.")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h1 className="font-mono text-xl font-semibold">Guides</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The handbooks for this platform — every screen in them is a real screenshot
          of the app.
        </p>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          {guides.map((g) => (
            <GuardedLink
              key={g.slug}
              href={`/dashboard/guides/${g.slug}`}
              className="flex items-start gap-3 rounded border border-slate-200 bg-white p-4 transition-colors duration-150 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-800 dark:hover:bg-slate-800"
            >
              <BookOpen
                className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-400"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base font-semibold">{g.title}</span>
                  <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-600 dark:text-slate-400">
                    {g.audience}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-slate-600 dark:text-slate-400">
                  {g.subtitle}
                </span>
              </span>
              <ChevronRight
                className="mt-1 h-4 w-4 shrink-0 text-slate-400"
                aria-hidden="true"
              />
            </GuardedLink>
          ))}
          {!error && guides.length === 0 && (
            <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              No handbooks are available for your account.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
