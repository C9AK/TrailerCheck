"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

import { useFormGuardStore } from "@/store/formGuardStore";

type Props = ComponentProps<typeof Link>;

/** R41: drop-in replacement for next/link's <Link> that checks the global
 * unsaved-changes guard (store/formGuardStore.ts) before navigating. Use
 * this anywhere a click could navigate away from a page with unsaved form
 * state — currently the sidebar/mobile nav. */
export default function GuardedLink({ href, onClick, ...rest }: Props) {
  const router = useRouter();
  const requestNavigation = useFormGuardStore((s) => s.requestNavigation);

  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        requestNavigation(() => router.push(href.toString()));
      }}
      {...rest}
    />
  );
}
