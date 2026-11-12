import type { Account, Signal, SignalType } from "../types";
import { companyTraits, industryMatches, techKey } from "../traits";
import type { IcpModel } from "./icp-lift";
import { DIMENSION_LABELS } from "./icp-lift";
import { round } from "./stats";

/** Base strength (points) and half-life (days) per signal type. */
export const SIGNAL_RULES: Record<SignalType, { base: number; halfLife: number; label: string }> = {
  funding: { base: 30, halfLife: 60, label: "Funding" },
  leadership_change: { base: 25, halfLife: 45, label: "New leader" },
  hiring: { base: 22, halfLife: 30, label: "Hiring" },
  web_intent: { base: 20, halfLife: 14, label: "Website intent" },
  tech_adoption: { base: 18, halfLife: 90, label: "New tool" },
  headcount_growth: { base: 15, halfLife: 60, label: "Headcount growth" },
  news: { base: 10, halfLife: 30, label: "News" },
};

export const FIT_MAX = 60;
export const INTENT_MAX = 40;
export const TIER_THRESHOLDS = { tier1: 70, tier2: 45 };

export function signalStrength(s: Signal, at: Date = new Date()): number {
  const rule = SIGNAL_RULES[s.type] ?? SIGNAL_RULES.news;
  const ageDays = Math.max(0, (at.getTime() - new Date(s.date).getTime()) / 86_400_000);
  if (Number.isNaN(ageDays)) return rule.base * 0.5;
  return rule.base * Math.pow(0.5, ageDays / rule.halfLife);
}

export interface ScoreResult {
  score: number;
  fit: number;
  intent: number;
  tier: "Tier 1" | "Tier 2" | "Tier 3" | "Suppressed";
  reasons: string[];
  suppressed: string | null;
}

/**
 * Explainable score = ICP fit (0-60) + signal intent (0-40).
 * Fit: per dimension, the best matching trait weight from the ICP model, normalised by the best possible.
 * Intent: decayed signal strengths, strongest first, each extra signal counted at 60% of the previous.
 */
export function scoreAccount(a: Account, model: IcpModel | null, suppressed: string | null, at: Date = new Date()): ScoreResult {
  const reasons: string[] = [];
  let fit = 0;
  if (model && Object.keys(model.maxWeights).length) {
    const weights = new Map(model.traits.map((t) => [`${t.dimension}\u0000${t.value.toLowerCase()}`, t]));
    const best: Record<string, { w: number; label: string }> = {};
    const techWeights = new Map(model.traits.filter((t) => t.dimension === "tech").map((t) => [techKey(t.value), t]));
    for (const tr of companyTraits(a)) {
      const stat = weights.get(`${tr.dimension}\u0000${tr.value.toLowerCase()}`) ?? (tr.dimension === "tech" ? techWeights.get(techKey(tr.value)) : undefined);
      if (!stat || stat.weight === 0) continue;
      const cur = best[tr.dimension];
      if (!cur || stat.weight > cur.w) best[tr.dimension] = { w: stat.weight, label: `${tr.value} (lift ${stat.lift}x)` };
    }
    // Vendor industries ("Software Development") rarely equal CRM labels ("B2B SaaS"), so match through aliases.
    // A match on the vendor industry wins over one found only in the description.
    if (!best.industry && (a.industry || a.description)) {
      const inds = model.traits.filter((t) => t.dimension === "industry" && t.weight !== 0);
      for (const pass of ["industry", "description"] as const) {
        const hits = inds.filter((t) => industryMatches(t.value, a.industry, pass === "description" ? a.description : undefined) === pass);
        if (!hits.length) continue;
        // A bad-fit match (e.g. Marketing) outweighs a good one, so an agency that mentions SaaS doesn't score as SaaS.
        const neg = hits.filter((t) => t.weight < 0).sort((x, y) => x.weight - y.weight)[0];
        const pos = hits.filter((t) => t.weight > 0).sort((x, y) => y.weight - x.weight)[0];
        const t = neg ?? pos;
        best.industry = { w: t.weight, label: `${t.value} (via ${pass === "industry" ? a.industry : "description"}, lift ${t.lift}x)` };
        break;
      }
    }
    // Only company-level dimensions can be matched on an account.
    const dims = Object.keys(model.maxWeights).filter((d) => ["industry", "company_size", "region", "tech"].includes(d));
    const possible = dims.reduce((s, d) => s + model.maxWeights[d], 0);
    const got = Object.entries(best).reduce((s, [, v]) => s + v.w, 0);
    fit = possible > 0 ? Math.max(0, Math.min(1, got / possible)) * FIT_MAX : 0;
    for (const [dim, v] of Object.entries(best)) {
      reasons.push(`${v.w > 0 ? "+" : "-"} ${DIMENSION_LABELS[dim] ?? dim}: ${v.label}`);
    }
    for (const d of dims) if (!best[d]) reasons.push(`· ${DIMENSION_LABELS[d] ?? d}: no ICP match`);
  } else {
    reasons.push("· No ICP model yet: fit is 0. Run build_icp first.");
  }

  const strengths = a.signals
    .map((s) => ({ s, v: signalStrength(s, at) }))
    .sort((x, y) => y.v - x.v);
  let intent = 0;
  strengths.forEach(({ s, v }, i) => {
    const add = v * Math.pow(0.6, i);
    intent += add;
    if (add >= 1) {
      const age = Math.round((at.getTime() - new Date(s.date).getTime()) / 86_400_000);
      const label = SIGNAL_RULES[s.type]?.label ?? s.type;
      const text = s.title.toLowerCase().startsWith(label.toLowerCase()) ? s.title : `${label}: ${s.title}`;
      reasons.push(`+ ${text} (${age}d ago, +${round(add, 1)})`);
    }
  });
  intent = Math.min(INTENT_MAX, intent);
  if (!a.signals.length) reasons.push("· No buying signals found");

  const score = round(fit + intent, 1);
  let tier: ScoreResult["tier"] = score >= TIER_THRESHOLDS.tier1 ? "Tier 1" : score >= TIER_THRESHOLDS.tier2 ? "Tier 2" : "Tier 3";
  if (suppressed) {
    tier = "Suppressed";
    reasons.unshift(`× Suppressed: ${suppressed}`);
  }
  return { score, fit: round(fit, 1), intent: round(intent, 1), tier, reasons, suppressed };
}
