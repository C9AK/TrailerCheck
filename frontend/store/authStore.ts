import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Role } from "@/lib/types";

interface AuthState {
  token: string | null;
  role: Role | null;
  username: string | null;
  hasHydrated: boolean;
  setAuth: (token: string, role: Role, username: string) => void;
  logout: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      username: null,
      hasHydrated: false,
      setAuth: (token, role, username) => set({ token, role, username }),
      logout: () => set({ token: null, role: null, username: null }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "trailercheck-auth",
      partialize: (s) => ({ token: s.token, role: s.role, username: s.username }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);

/** Default landing route per role. */
export function homeRoute(role: Role): string {
  if (role === "qc") return "/dashboard/qc-review";
  if (role === "manager") return "/dashboard/carryover";
  return "/dashboard/new-pickup";
}
