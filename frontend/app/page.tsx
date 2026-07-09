"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { homeRoute, useAuthStore } from "@/store/authStore";

export default function IndexPage() {
  const router = useRouter();
  const { token, role, hasHydrated } = useAuthStore();

  useEffect(() => {
    if (!hasHydrated) return;
    router.replace(token && role ? homeRoute(role) : "/login");
  }, [hasHydrated, token, role, router]);

  return null;
}
