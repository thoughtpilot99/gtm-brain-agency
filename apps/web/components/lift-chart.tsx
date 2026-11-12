import type { TraitStat } from "@gtm/core";
import { DIMENSION_LABELS } from "@gtm/core";

/**
 * Diverging lift chart on a log scale centred at 1x.
 * Right of centre: traits over-represented in wins. Left: over-represented in losses.
 * Bar opacity encodes confidence, so thin evidence looks thin.
 */
export function LiftChart({ traits, nWon, nLost, limitPerDim = 6 }: { traits: TraitStat[]; nWon: number; nLost: number; limitPerDim?: number }) {
  const MAX = 3; // log2 range: 1/8x .. 8x
  const dims = Object.keys(DIMENSION_LABELS).filter((d) => traits.some((t) => t.dimension === d));
  let i = 0;
  return (
    <div role="figure" aria-label="Lift of each trait in won versus lost deals">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr 160px", gap: "0 14px", fontSize: "0.8rem" }} className="faint">
        <span />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Losses</span>
          <span>1×</span>
          <span>Wins</span>
        </div>
        <span style={{ textAlign: "right" }}>Wins · losses</span>
      </div>
      {dims.map((dim) => {
        const rows = traits
          .filter((t) => t.dimension === dim && (t.verdict !== "neutral" || t.won + t.lost >= 4))
          .sort((a, b) => b.lift - a.lift)
          .slice(0, limitPerDim);
        if (!rows.length) return null;
        return (
          <div key={dim} style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: "0.92rem", marginBottom: 6 }}>{DIMENSION_LABELS[dim]}</h3>
            {rows.map((t) => {
              const l = Math.max(-MAX, Math.min(MAX, Math.log2(t.lift)));
              const width = (Math.abs(l) / MAX) * 50;
              const pos = l >= 0;
              const color = t.verdict === "negative" ? "var(--bad)" : t.verdict === "core" ? "var(--t1)" : t.verdict === "positive" ? "var(--t1)" : "var(--t3)";
              const opacity = t.confidence === "high" ? 1 : t.confidence === "medium" ? 0.75 : 0.4;
              return (
                <div
                  key={t.value}
                  style={{ display: "grid", gridTemplateColumns: "minmax(120px, 190px) 1fr 160px", gap: "0 14px", alignItems: "center", padding: "3px 0" }}
                  title={`${t.value}: ${t.won}/${nWon} wins vs ${t.lost}/${nLost} losses · lift ${t.lift}x · ${t.confidence} confidence (z=${t.z})`}
                >
                  <span style={{ fontWeight: t.verdict === "core" ? 650 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.value}</span>
                  <div style={{ position: "relative", height: 18 }}>
                    <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "var(--line)" }} />
                    <div
                      className="lift-bar"
                      style={
                        {
                          position: "absolute",
                          top: 3,
                          height: 12,
                          borderRadius: pos ? "0 3px 3px 0" : "3px 0 0 3px",
                          left: pos ? "50%" : `${50 - width}%`,
                          width: `${Math.max(width, 0.6)}%`,
                          background: color,
                          opacity,
                          "--origin": pos ? "left" : "right",
                          "--i": i++,
                        } as React.CSSProperties
                      }
                    />
                    <span
                      className="num small"
                      style={{ position: "absolute", top: 0, [pos ? "left" : "right"]: `calc(${50 + width}% + 6px)`, ...(pos ? {} : { right: `calc(${50 + width}% + 6px)` }), fontWeight: 600, color }}
                    >
                      {t.lift}×
                    </span>
                  </div>
                  <span className="num small muted" style={{ textAlign: "right" }}>
                    {t.won} · {t.lost}
                    {t.verdict === "core" ? <span className="pill good" style={{ marginLeft: 8 }}>Core</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
