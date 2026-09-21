"use client";

import { ArrowLeft, ExternalLink, Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import GuardedLink from "@/components/GuardedLink";
import RequireRole from "@/components/RequireRole";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { GuideDocument } from "@/lib/types";

export default function GuidePage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <Guide />
    </RequireRole>
  );
}

/** R53: the handbook text comes from the (auth-gated) API, but its ~3 MB of
 * screenshots are plain static files on this origin — rewrite the document's
 * relative `img/...` paths to that public folder before rendering. */
function withResolvedImages(html: string): string {
  return html.replace(/src="img\//g, `src="${window.location.origin}/guides/img/`);
}

function Guide() {
  const slug = String(useParams().slug ?? "");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [guide, setGuide] = useState<GuideDocument | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;

    api<GuideDocument>(`/api/guides/${encodeURIComponent(slug)}`)
      .then((doc) => {
        if (cancelled) return;
        setGuide(doc);
        // A blob URL, not srcdoc: the handbooks are chapter documents whose
        // table of contents is all `#anchor` links, and those only resolve
        // inside the frame when the document has a real base URL of its own.
        const url = URL.createObjectURL(
          new Blob([withResolvedImages(doc.html)], { type: "text/html;charset=utf-8" })
        );
        revoke = url;
        setBlobUrl(url);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Failed to load this guide.");
      });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [slug]);

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-96 flex-col md:h-[calc(100dvh-5.5rem)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GuardedLink
          href="/dashboard/guides"
          className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Guides
        </GuardedLink>
        <h1 className="min-w-0 flex-1 truncate font-mono text-lg font-semibold">
          {guide?.title ?? (error ? "Handbook" : "Loading...")}
        </h1>
        {blobUrl && (
          <>
            <button
              type="button"
              onClick={() => frameRef.current?.contentWindow?.print()}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </button>
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Full screen
            </a>
          </>
        )}
      </div>

      <ErrorBanner message={error} />

      {!error &&
        (blobUrl ? (
          <iframe
            ref={frameRef}
            src={blobUrl}
            title={guide?.title ?? "Guide"}
            className="min-h-0 flex-1 rounded border border-slate-200 bg-white dark:border-slate-700"
          />
        ) : (
          <Skeleton className="min-h-0 flex-1" />
        ))}
    </div>
  );
}
