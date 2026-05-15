"use client";

/**
 * Global sticky navigation bar. Rendered once in the root layout so it
 * persists across every authenticated page. Hidden on /login.
 *
 * Adapts to the signed-in user's role (fetched from /api/me):
 *   - "admin"      -> shows all four sections
 *   - "data-entry" -> shows only POST IT Portal (and Sign out)
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "admin" | "data-entry" | "unknown";

const ADMIN_LINKS = [
  { href: "/reci",            label: "RECI Boards" },
  { href: "/reci/analytics",  label: "RECI Analytics" },
  { href: "/reci/tracker",    label: "Deal Tracker" },
  { href: "/dashboard",       label: "Call-Centre Dashboard" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/reci/analytics") return pathname === "/reci/analytics";
  if (href === "/reci/tracker")   return pathname === "/reci/tracker";
  if (href === "/reci") {
    // Any /reci/* board page (but not the standalone analytics / tracker
    // pages) counts as Boards.
    if (pathname === "/reci") return true;
    if (!pathname.startsWith("/reci/")) return false;
    return pathname !== "/reci/analytics" && pathname !== "/reci/tracker";
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<Role>("unknown");

  useEffect(() => {
    // Don't bother fetching on the login page.
    if (pathname === "/login" || pathname.startsWith("/login/")) return;
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { role?: Role } | null) => {
        if (alive && j?.role) setRole(j.role);
      })
      .catch(() => { /* ignore */ });
    return () => { alive = false; };
  }, [pathname]);

  // No chrome on the login screen.
  if (pathname === "/login" || pathname.startsWith("/login/")) return null;

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore — still redirect */
    }
    window.location.href = "/login";
  }

  const showAdminLinks = role === "admin";

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-1 px-4 py-2">
        <Link
          href="/"
          className={`mr-3 text-sm font-semibold transition-colors ${
            pathname === "/" ? "text-slate-900" : "text-slate-700 hover:text-slate-900"
          }`}
        >
          POST IT Portal
        </Link>
        {showAdminLinks && ADMIN_LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={signOut}
          className="ml-auto rounded px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
