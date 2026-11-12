"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useEffect, useState } from "react";

export function Nav({ base, items }: { base: string; items: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Client sections">
      {items.map((i) => {
        const href = `${base}${i.href}`;
        const active = i.href === "" ? path === base : path === href || path.startsWith(href + "/");
        return (
          <Link key={i.href} href={href} aria-current={active ? "page" : undefined}>
            <span>{i.label}</span>
            {i.count ? <span className="count num">{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function ClientSwitcher({ current, clients }: { current: string; clients: { slug: string; name: string }[] }) {
  const router = useRouter();
  return (
    <label className="field">
      <span>Client</span>
      <select className="select" value={current} onChange={(e) => router.push(e.target.value === "__all" ? "/" : `/c/${e.target.value}`)}>
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
        <option value="__all">All clients…</option>
      </select>
    </label>
  );
}

export function Submit({ children, pendingText, className = "btn primary", name, value }: { children: React.ReactNode; pendingText?: string; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} name={name} value={value}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

/** Light (grey-white, black buttons) by default; dark on request. Remembered per browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gtm-theme");
      if (saved === "dark") setTheme("dark");
    } catch {
      /* storage blocked: stay light */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("gtm-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return (
    <button type="button" className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Switch colour theme">
      {theme === "light" ? "Dark mode" : "Light mode"}
    </button>
  );
}
