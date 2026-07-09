"use client";

import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, SuccessBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { MCAdmin, Role, User } from "@/lib/types";

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
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-3 py-2 font-medium">{u.username}</td>
                <td className="px-3 py-2 font-mono text-xs uppercase">{u.role}</td>
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
                  {u.is_active ? "Active" : "Inactive"}
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
            </tr>
          </thead>
          <tbody>
            {mcs.map((mc) => (
              <tr key={mc.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <td className="px-3 py-2 font-medium">{mc.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{mc.api_endpoint}</td>
                <td className="px-3 py-2 font-mono text-xs">{mc.api_key_masked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
