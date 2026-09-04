"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { Role } from "@/lib/types";
import { roleAllows } from "@/lib/types";
import { homeRoute, useAuthStore } from "@/store/authStore";

/** Client-side RBAC guard: redirects users whose role isn't allowed on this
 * page. R52: `roleAllows` admits `admin` wherever `manager` is listed, so
 * existing `roles={["manager"]}` (etc.) page guards didn't need updating
 * when the admin role was introduced. */
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
    if (hasHydrated && role && !roleAllows(roles, role)) router.replace(homeRoute(role));
  }, [hasHydrated, role, roles, router]);

  if (!hasHydrated || !role || !roleAllows(roles, role)) return null;
  return <>{children}</>;
}
