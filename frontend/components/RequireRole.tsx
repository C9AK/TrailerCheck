"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { Role } from "@/lib/types";
import { homeRoute, useAuthStore } from "@/store/authStore";

/** Client-side RBAC guard: redirects users whose role isn't allowed on this page. */
export default function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { role, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (hasHydrated && role && !roles.includes(role)) router.replace(homeRoute(role));
  }, [hasHydrated, role, roles, router]);

  if (!hasHydrated || !role || !roles.includes(role)) return null;
  return <>{children}</>;
}
