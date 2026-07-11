"use client";

import { Check, KeyRound, Loader2, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, SuccessBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { MCAdmin, Role, User } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const ROLES: Role[] = ["employee", "qc", "manager"];

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

export default function AdminPage() {
  return (
    <RequireRole roles={["manager"]}>
      <div className="mx-auto max-w-5xl space-y-8">
        <h1 className="font-mono text-xl font-semibold">Admin</h1>
        <UsersSection />
        <MCSection />
      </div>
    </RequireRole>
  );
}

function UsersSection() {
  const myUsername = useAuthStore((s) => s.username);
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline user editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("employee");
  const [editPassword, setEditPassword] = useState("");
  const [editActive, setEditActive] = useState(true);

  async function saveUser(u: User) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = { role: editRole, is_active: editActive };
      if (editPassword.trim()) body.password = editPassword.trim();
      await api<User>(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSuccess(`User "${u.username}" updated.`);
      setEditingId(null);
      setEditPassword("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(u: User) {
    if (!window.confirm(`Delete user "${u.username}" permanently?`)) return;
    setError(null);
    setSuccess(null);
    try {
      await api<void>(`/api/admin/users/${u.id}`, { method: "DELETE" });
      setSuccess(`User "${u.username}" deleted.`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed.");
    }
  }

  const load = useCallback(() => {
    api<User[]>("/api/admin/users")
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load users."));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const u = await api<User>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, password, role }),
      });
      setSuccess(`User "${u.username}" created (${u.role}).`);
      setUsername("");
      setPassword("");
      setRole("employee");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Users & Performance Scorecard
      </h2>

      <form onSubmit={createUser} className="mb-4 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="new-username" className="mb-1 block text-sm font-medium">
            Username <span className="text-red-600">*</span>
          </label>
          <input
            id="new-username"
            required
            minLength={3}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium">
            Password <span className="text-red-600">*</span>
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Min. 8 characters</p>
        </div>
        <div>
          <label htmlFor="new-role" className="mb-1 block text-sm font-medium">
            Role
          </label>
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputCls}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Create User
          </button>
        </div>
      </form>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2 text-right">Performance Score</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-3 py-2 font-medium">
                  {u.username}
                  {u.username === myUsername && (
                    <span className="ml-1.5 text-xs text-slate-400">(you)</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs uppercase">
                  {editingId === u.id ? (
                    <select
                      aria-label={`Role for ${u.username}`}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as Role)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    u.role
                  )}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold ${
                    u.performance_score < 70
                      ? "text-red-600 dark:text-red-400"
                      : u.performance_score < 100
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {u.performance_score}
                </td>
                <td className="px-3 py-2 text-xs">
                  {editingId === u.id ? (
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={editActive}
                        onChange={(e) => setEditActive(e.target.checked)}
                        className="h-3.5 w-3.5 accent-brand-600"
                      />
                      Active
                    </label>
                  ) : u.is_active ? (
                    "Active"
                  ) : (
                    <span className="font-semibold text-red-600 dark:text-red-400">Inactive</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editingId === u.id ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <input
                        type="password"
                        placeholder="New password (optional)"
                        value={editPassword}
                        onChange={(e) => setEditPassword(e.target.value)}
                        className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                      />
                      <button
                        type="button"
                        aria-label="Save user"
                        disabled={busy}
                        onClick={() => saveUser(u)}
                        className="cursor-pointer rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel edit"
                        onClick={() => setEditingId(null)}
                        className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        aria-label={`Edit ${u.username}`}
                        onClick={() => {
                          setEditingId(u.id);
                          setEditRole(u.role);
                          setEditActive(u.is_active);
                          setEditPassword("");
                        }}
                        className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {u.username !== myUsername && (
                        <button
                          type="button"
                          aria-label={`Delete ${u.username}`}
                          onClick={() => deleteUser(u)}
                          className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MCSection() {
  const [mcs, setMcs] = useState<MCAdmin[]>([]);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline MC editor
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEndpoint, setEditEndpoint] = useState("");
  const [editKey, setEditKey] = useState("");

  async function saveMC(mc: MCAdmin) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const body: Record<string, unknown> = {};
      if (editEndpoint.trim() && editEndpoint.trim() !== mc.api_endpoint) {
        body.api_endpoint = editEndpoint.trim();
      }
      if (editKey.trim()) body.api_key = editKey.trim();
      if (Object.keys(body).length > 0) {
        await api<MCAdmin>(`/api/admin/mcs/${mc.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setSuccess(`Motor Carrier "${mc.name}" updated.`);
        load();
      }
      setEditingId(null);
      setEditKey("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  const load = useCallback(() => {
    api<MCAdmin[]>("/api/admin/mcs")
      .then(setMcs)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load Motor Carriers.")
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createMC(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const mc = await api<MCAdmin>("/api/admin/mcs", {
        method: "POST",
        body: JSON.stringify({ name, api_endpoint: endpoint, api_key: apiKey }),
      });
      setSuccess(`Motor Carrier "${mc.name}" added.`);
      setName("");
      setEndpoint("");
      setApiKey("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add Motor Carrier.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Motor Carriers & Telematics API Keys
      </h2>

      <form onSubmit={createMC} className="mb-4 grid gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="mc-name" className="mb-1 block text-sm font-medium">
            Name <span className="text-red-600">*</span>
          </label>
          <input
            id="mc-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company A"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="mc-endpoint" className="mb-1 block text-sm font-medium">
            API Endpoint <span className="text-red-600">*</span>
          </label>
          <input
            id="mc-endpoint"
            type="url"
            required
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://api.fleet.example.com/v1"
            className={`${inputCls} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="mc-key" className="mb-1 block text-sm font-medium">
            API Key <span className="text-red-600">*</span>
          </label>
          <input
            id="mc-key"
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Stored server-side; shown masked after saving.
          </p>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add MC
          </button>
        </div>
      </form>

      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">API Key</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mcs.map((mc) => (
              <tr key={mc.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-3 py-2 font-medium">{mc.name}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {editingId === mc.id ? (
                    <input
                      aria-label={`Endpoint for ${mc.name}`}
                      value={editEndpoint}
                      onChange={(e) => setEditEndpoint(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                  ) : (
                    mc.api_endpoint
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {editingId === mc.id ? (
                    <input
                      type="password"
                      placeholder="New token (blank = keep current)"
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                    />
                  ) : (
                    mc.api_key_masked
                  )}
                </td>
                <td className="px-3 py-2">
                  {editingId === mc.id ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Save MC"
                        disabled={busy}
                        onClick={() => saveMC(mc)}
                        className="cursor-pointer rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel edit"
                        onClick={() => setEditingId(null)}
                        className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  ) : (
                    <span className="flex justify-center">
                      <button
                        type="button"
                        aria-label={`Edit ${mc.name}`}
                        onClick={() => {
                          setEditingId(mc.id);
                          setEditEndpoint(mc.api_endpoint);
                          setEditKey("");
                        }}
                        className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
