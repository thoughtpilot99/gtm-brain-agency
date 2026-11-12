import Link from "next/link";

export function TierBadge({ tier }: { tier?: string | null }) {
  if (!tier) return <span className="tier tier-3">Unscored</span>;
  const cls = tier === "Tier 1" ? "tier-1" : tier === "Tier 2" ? "tier-2" : tier === "Suppressed" ? "tier-s" : "tier-3";
  return <span className={`tier ${cls}`}>{tier}</span>;
}

export function Meter({ fit = 0, intent = 0 }: { fit?: number; intent?: number }) {
  return (
    <div className="meter" title={`Fit ${fit}/60 · Intent ${intent}/40`} aria-label={`Fit ${fit} of 60, intent ${intent} of 40`}>
      <div className="fit" style={{ width: `${(fit / 100) * 100}%` }} />
      <div className="intent" style={{ width: `${(intent / 100) * 100}%` }} />
    </div>
  );
}

export function Figure({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="figure">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function PageHead({ title, lead, children }: { title: string; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

export function Flash({ msg, kind }: { msg?: string; kind?: string }) {
  if (!msg) return null;
  return (
    <div className={`notice ${kind === "error" ? "bad" : "good"}`} role="status" style={{ marginBottom: 20 }}>
      {msg}
    </div>
  );
}

export function Empty({ title, children, href, cta }: { title: string; children?: React.ReactNode; href?: string; cta?: string }) {
  return (
    <div style={{ padding: "28px 4px" }}>
      <h3>{title}</h3>
      {children ? <p className="muted" style={{ marginTop: 6, maxWidth: "60ch" }}>{children}</p> : null}
      {href && cta ? (
        <Link className="btn" href={href} style={{ marginTop: 14 }}>
          {cta}
        </Link>
      ) : null}
    </div>
  );
}

export function ModeBadge({ mode, reason }: { mode: "live" | "sample" | "off"; reason: string }) {
  return (
    <span className={`pill ${mode === "live" ? "good" : "warn"}`} title={reason}>
      {mode === "live" ? "Live data" : mode === "off" ? "No data key" : "Sample data"}
    </span>
  );
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
export const daysAgo = (iso: string) => {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export function BrainMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ink)" />
      <path d="M8 21 L13 15 L17 18 L24 9" stroke="var(--paper)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="2.6" fill="var(--paper)" />
    </svg>
  );
}
