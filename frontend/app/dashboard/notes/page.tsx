"use client";

import {
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, SuccessBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { AutoNote, ShiftNote } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const POLL_MS = 20_000;

export default function NotesPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <NotesBoard />
    </RequireRole>
  );
}

function NotesBoard() {
  const role = useAuthStore((s) => s.role);
  const canHandover = role === "employee" || role === "manager";

  const [autoNotes, setAutoNotes] = useState<AutoNote[]>([]);
  const [drafts, setDrafts] = useState<ShiftNote[]>([]);
  const [globalNotes, setGlobalNotes] = useState<ShiftNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const loadDrafts = useCallback(async () => {
    if (!canHandover) return;
    try {
      const d = await api<{ auto_notes: AutoNote[]; manual_drafts: ShiftNote[] }>(
        "/api/notes/drafts"
      );
      setAutoNotes(d.auto_notes);
      setDrafts(d.manual_drafts);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load drafts.");
    }
  }, [canHandover]);

  const loadGlobal = useCallback(async () => {
    try {
      setGlobalNotes(await api<ShiftNote[]>("/api/notes/global"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load the team inbox.");
    }
  }, []);

  useEffect(() => {
    loadDrafts();
    loadGlobal();
    const id = setInterval(loadGlobal, POLL_MS);
    return () => clearInterval(id);
  }, [loadDrafts, loadGlobal]);

  async function addDraft() {
    const content = newNote.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      await api<ShiftNote>("/api/notes", {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setNewNote("");
      loadDrafts();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save the note.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{
        published_auto: number;
        published_manual: number;
        skipped_duplicates: number;
      }>("/api/notes/publish", { method: "POST" });
      setNotice(
        `Handover published: ${r.published_auto} auto note(s) + ${r.published_manual} manual note(s)` +
          (r.skipped_duplicates > 0 ? ` (${r.skipped_duplicates} already on the board).` : ".")
      );
      loadDrafts();
      loadGlobal();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(note: ShiftNote) {
    setSavingId(note.id);
    setError(null);
    try {
      await api<ShiftNote>(`/api/notes/${note.id}/resolve`, { method: "PATCH" });
      setGlobalNotes((prev) => prev.filter((n) => n.id !== note.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resolve the note.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveEdit(note: ShiftNote) {
    const content = editText.trim();
    if (!content) return;
    setSavingId(note.id);
    setError(null);
    try {
      const updated = await api<ShiftNote>(`/api/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      });
      setGlobalNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      setDrafts((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Edit failed.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="font-mono text-xl font-semibold">Shift Notes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Automated shift handover — what the next shift needs to know
        </p>
      </div>

      <ErrorBanner message={error} />
      <SuccessBanner message={notice} />

      {/* Section A: My Shift Notes (draft / pre-publish) */}
      {canHandover && (
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            My Shift Notes — ready to hand over
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Auto-compiled from your carryover tickets, plus anything you type below.
          </p>

          {autoNotes.length === 0 && drafts.length === 0 && (
            <p className="mb-3 rounded border border-dashed border-slate-300 p-3 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Nothing pending — no open carryover gaps and no manual notes.
            </p>
          )}

          <ul className="mb-3 space-y-1.5">
            {autoNotes.map((n, i) => (
              <li
                key={`${n.content}-${i}`}
                className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60"
              >
                <Sparkles
                  className="h-4 w-4 shrink-0 text-brand-600"
                  role="img"
                  aria-label="Auto-generated"
                />
                {n.content}
              </li>
            ))}
            {drafts.map((n) => (
              <li
                key={n.id}
                className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {editingId === n.id ? (
                  <>
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      aria-label="Save note"
                      disabled={savingId === n.id}
                      onClick={() => saveEdit(n)}
                      className="cursor-pointer rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel edit"
                      onClick={() => setEditingId(null)}
                      className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">{n.content}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                      draft
                    </span>
                    <button
                      type="button"
                      aria-label="Edit note"
                      onClick={() => {
                        setEditingId(n.id);
                        setEditText(n.content);
                      }}
                      className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="mb-4 flex gap-2">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder='e.g. "Driver for 4005 said his phone died, call dispatch at 8 PM"'
              className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={addDraft}
              disabled={busy || !newNote.trim()}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add note
            </button>
          </div>

          <button
            type="button"
            onClick={publish}
            disabled={busy || (autoNotes.length === 0 && drafts.length === 0)}
            className="flex cursor-pointer items-center gap-2 rounded bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Publish Shift Handover
          </button>
        </section>
      )}

      {/* Section B: Global Shift Notes (team inbox) */}
      <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Global Shift Notes — team inbox ({globalNotes.length})
          </h2>
          <button
            type="button"
            onClick={loadGlobal}
            aria-label="Refresh inbox"
            className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {globalNotes.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            The board is clear — no open handover notes.
          </p>
        )}

        <ul className="space-y-2">
          {globalNotes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              {editingId === n.id ? (
                <div className="flex items-center gap-2">
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  />
                  <button
                    type="button"
                    aria-label="Save note"
                    disabled={savingId === n.id}
                    onClick={() => saveEdit(n)}
                    className="cursor-pointer rounded p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel edit"
                    onClick={() => setEditingId(null)}
                    className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{n.content}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {n.is_auto_generated && (
                        <span className="flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 font-sans font-semibold text-brand-700 dark:bg-brand-800/30 dark:text-brand-300">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          auto
                        </span>
                      )}
                      {n.creator.username} · {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  {(role === "employee" || role === "manager") && (
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditText(n.content);
                        }}
                        className="flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={savingId === n.id}
                        onClick={() => resolve(n)}
                        className="flex cursor-pointer items-center gap-1 rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Done
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
