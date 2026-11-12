import type { DealRow } from "../types";
import { companyTraits, functionOf, seniorityOf } from "../traits";
import { pct, round, twoProportionZ, twoSidedP } from "./stats";

export type Verdict = "core" | "positive" | "neutral" | "negative";

export interface TraitStat {
  dimension: string;
  value: string;
  won: number;
  lost: number;
  /** Share of won deals that have the trait. */
  wonShare: number;
  /** Share of lost deals that have the trait. */
  lostShare: number;
  /** Smoothed ratio of wonShare to lostShare. >1 means the trait shows up more in wins. */
  lift: number;
  /** Win rate among deals with this trait. */
  winRate: number;
  z: number;
  pValue: number;
  confidence: "high" | "medium" | "low";
  verdict: Verdict;
  /** Scoring weight: ln(lift), clipped, zero when the evidence is too thin. */
  weight: number;
}

export interface IcpModel {
  builtAt: string;
  nWon: number;
  nLost: number;
  baselineWinRate: number;
  traits: TraitStat[];
  /** Best positive values per dimension, used for the written profile and searches. */
  profile: Record<string, string[]>;
  /** Max positive weight per dimension (used to normalise fit scores). */
  maxWeights: Record<string, number>;
  medianDealValue?: number;
  warnings: string[];
}

export const DIMENSION_LABELS: Record<string, string> = {
  industry: "Industry",
  company_size: "Company size",
  region: "Region",
  tech: "Tools they use",
  signer_seniority: "Seniority of who signed",
  signer_function: "Function of who signed",
};

export function dealTraits(d: DealRow): { dimension: string; value: string }[] {
  const out = companyTraits({ industry: d.industry, employees: d.employees, region: d.region, tech: d.tech });
  if (d.signerTitle) {
    out.push({ dimension: "signer_seniority", value: seniorityOf(d.signerTitle) });
    out.push({ dimension: "signer_function", value: functionOf(d.signerTitle) });
  }
  return out;
}

/**
 * Statistical lift of every trait in won vs lost deals.
 * Uses add-one smoothing for the ratio and a pooled two-proportion z-test for confidence,
 * so a trait seen in 2 wins and 0 losses does not outrank one seen in 30 wins and 5 losses.
 */
export function buildIcpModel(deals: DealRow[]): IcpModel {
  const won = deals.filter((d) => d.outcome === "won");
  const lost = deals.filter((d) => d.outcome === "lost");
  const nWon = won.length;
  const nLost = lost.length;
  const warnings: string[] = [];
  if (nWon < 10) warnings.push(`Only ${nWon} won deals. Treat the ICP as a hypothesis until you have 20 or more.`);
  if (nLost < 10) warnings.push(`Only ${nLost} lost deals. Lift is less reliable without enough losses to compare against.`);

  const counts = new Map<string, { dimension: string; value: string; won: number; lost: number }>();
  const add = (d: DealRow, key: "won" | "lost") => {
    const seen = new Set<string>();
    for (const t of dealTraits(d)) {
      const id = `${t.dimension}\u0000${t.value.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const c = counts.get(id) ?? { dimension: t.dimension, value: t.value, won: 0, lost: 0 };
      c[key]++;
      counts.set(id, c);
    }
  };
  won.forEach((d) => add(d, "won"));
  lost.forEach((d) => add(d, "lost"));

  const traits: TraitStat[] = [];
  for (const c of counts.values()) {
    if (c.won + c.lost < 2) continue;
    const wonShare = nWon ? c.won / nWon : 0;
    const lostShare = nLost ? c.lost / nLost : 0;
    // Add-one (Laplace) smoothing keeps traits never seen in losses from showing absurd lifts.
    const lift = ((c.won + 1) / (nWon + 2)) / ((c.lost + 1) / (nLost + 2));
    const z = twoProportionZ(c.won, nWon, c.lost, nLost);
    const absZ = Math.abs(z);
    const confidence = absZ >= 2.58 ? "high" : absZ >= 1.96 ? "medium" : "low";
    let verdict: Verdict = "neutral";
    if (lift >= 1.5 && z >= 1.96 && c.won >= 3) verdict = "core";
    else if (lift >= 1.2 && z >= 1.0 && c.won >= 2) verdict = "positive";
    else if (lift <= 0.67 && z <= -1.0) verdict = "negative";
    const evidence = Math.min(1, absZ / 1.96);
    const weight = verdict === "neutral" ? 0 : Math.max(-1, Math.min(1.5, Math.log(lift))) * evidence;
    traits.push({
      dimension: c.dimension,
      value: c.value,
      won: c.won,
      lost: c.lost,
      wonShare: round(wonShare, 3),
      lostShare: round(lostShare, 3),
      lift: round(lift, 2),
      winRate: round(c.won / (c.won + c.lost), 3),
      z: round(z, 2),
      pValue: round(twoSidedP(z), 4),
      confidence,
      verdict,
      weight: round(weight, 3),
    });
  }
  traits.sort((a, b) => b.weight - a.weight || b.won - a.won);

  const profile: Record<string, string[]> = {};
  const maxWeights: Record<string, number> = {};
  for (const t of traits) {
    if (t.weight > 0) {
      maxWeights[t.dimension] = Math.max(maxWeights[t.dimension] ?? 0, t.weight);
      if (t.verdict === "core" || t.verdict === "positive") (profile[t.dimension] ??= []).push(t.value);
    }
  }
  const values = won.map((d) => d.dealValue).filter((v): v is number => !!v).sort((a, b) => a - b);
  const medianDealValue = values.length ? values[Math.floor(values.length / 2)] : undefined;
  if (!Object.keys(profile).length && nWon > 0) warnings.push("No trait separates wins from losses with confidence yet.");

  return {
    builtAt: new Date().toISOString(),
    nWon,
    nLost,
    baselineWinRate: round(nWon + nLost ? nWon / (nWon + nLost) : 0, 3),
    traits,
    profile,
    maxWeights,
    medianDealValue,
    warnings,
  };
}

/** Deterministic icp.md: every line cites the numbers behind it. */
export function renderIcpMarkdown(m: IcpModel, opts: { clientName: string; summary?: string }): string {
  const lines: string[] = [];
  const t = (x: TraitStat) =>
    `${x.value}: in ${x.won} of ${m.nWon} wins (${pct(x.wonShare)}) vs ${x.lost} of ${m.nLost} losses (${pct(x.lostShare)}). Lift ${x.lift}x, win rate ${pct(x.winRate)}, ${x.confidence} confidence (z=${x.z}).`;
  lines.push(`# ICP: ${opts.clientName}`, "");
  lines.push(
    `Built ${m.builtAt.slice(0, 10)} from ${m.nWon} closed-won and ${m.nLost} closed-lost deals. Baseline win rate ${pct(m.baselineWinRate)}.`,
  );
  if (m.medianDealValue) lines.push(`Median won deal value: ${m.medianDealValue.toLocaleString("en-US")}.`);
  lines.push("");
  if (opts.summary) lines.push("## Summary", opts.summary.trim(), "");
  lines.push("## Who buys from us");
  const core = m.traits.filter((x) => x.verdict === "core" || x.verdict === "positive");
  if (!core.length) lines.push("- not found: no trait separates wins from losses with confidence yet");
  for (const dim of Object.keys(DIMENSION_LABELS)) {
    const rows = core.filter((x) => x.dimension === dim);
    if (!rows.length) continue;
    lines.push(`### ${DIMENSION_LABELS[dim]}`);
    for (const x of rows) lines.push(`- ${x.verdict === "core" ? "**Core** " : ""}${t(x)}`);
  }
  lines.push("", "## Who does not buy from us");
  const neg = m.traits.filter((x) => x.verdict === "negative");
  if (!neg.length) lines.push("- not found: no trait is clearly over-represented in losses");
  for (const x of neg) lines.push(`- ${DIMENSION_LABELS[x.dimension] ?? x.dimension}: ${t(x)}`);
  if (m.warnings.length) {
    lines.push("", "## Caveats");
    for (const w of m.warnings) lines.push(`- ${w}`);
  }
  lines.push(
    "",
    "## How to read this",
    "- Lift = share of wins with the trait divided by share of losses with it. Above 1.5x with medium or high confidence is marked Core.",
    "- Confidence comes from a two-proportion z-test. Low confidence means the sample is too small to trust yet.",
    "",
    "## Sources",
    "1. Closed-won CRM data (data/closed-won.csv). Wins over every other source in a disagreement.",
    "2. Closed-lost CRM data (data/closed-lost.csv)",
    "3. Call notes (call-notes/)",
    "",
  );
  return lines.join("\n");
}
