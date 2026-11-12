import fs from "node:fs";
import { getClient, listBrainFiles, readBrainFile, safePath } from "./workspace";
import { bullets, placeholdersIn } from "./markdown";
import { listProposals } from "./proposals";
import { deals } from "../crm";
import type { IcpModel } from "../engines/icp-lift";
import { dealTraits } from "../engines/icp-lift";

export interface HealthCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  weight: number;
}

export interface Health {
  score: number;
  grade: "A" | "B" | "C" | "D";
  checks: HealthCheck[];
}

const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

export function loadIcpModel(slug: string): IcpModel | null {
  const p = safePath(slug, ".brain/icp-model.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as IcpModel;
  } catch {
    return null;
  }
}

/** Scores how ready the brain is for agents to use, and says exactly what to fix. */
export function brainHealth(slug: string): Health {
  getClient(slug);
  const checks: HealthCheck[] = [];
  const files = listBrainFiles(slug);
  const icp = readBrainFile(slug, "icp.md") ?? "";
  const offers = readBrainFile(slug, "offers.md") ?? "";
  const rules = readBrainFile(slug, "rules.md") ?? "";
  const agents = readBrainFile(slug, "AGENTS.md") ?? "";
  const model = loadIcpModel(slug);

  const add = (c: HealthCheck) => checks.push(c);

  if (!model) add({ id: "icp_built", label: "ICP built from CRM data", status: "fail", detail: "No ICP model yet.", fix: "Add closed-won and closed-lost CSVs to data/ and run build_icp.", weight: 20 });
  else {
    const age = daysSince(model.builtAt);
    const small = model.nWon < 20;
    add({
      id: "icp_built",
      label: "ICP built from CRM data",
      status: age > 90 || small ? "warn" : "pass",
      detail: `Built ${Math.round(age)} days ago from ${model.nWon} wins and ${model.nLost} losses.`,
      fix: age > 90 ? "Re-export deals and rebuild: the ICP is over 90 days old." : small ? "Fewer than 20 wins: treat the ICP as a hypothesis." : undefined,
      weight: 20,
    });
  }
  if (!/##\s*Sources/i.test(icp)) add({ id: "icp_sources", label: "ICP ranks its sources", status: "warn", detail: "icp.md has no Sources section.", fix: "Add a Sources section with closed-won data first.", weight: 5 });
  else add({ id: "icp_sources", label: "ICP ranks its sources", status: "pass", detail: "Sources are ranked.", weight: 5 });

  const proof = bullets(offers, /proof/i);
  add({
    id: "proof",
    label: "Proof you can name",
    status: proof.length >= 2 ? "pass" : proof.length === 1 ? "warn" : "fail",
    detail: `${proof.length} usable proof point(s) in offers.md.`,
    fix: proof.length < 2 ? "Add customer results you are allowed to name under 'Proof we can use'." : undefined,
    weight: 15,
  });
  const ctas = bullets(offers, /call(s)? to action|cta/i);
  add({ id: "cta", label: "Calls to action", status: ctas.length ? "pass" : "warn", detail: `${ctas.length} call(s) to action.`, fix: ctas.length ? undefined : "Add a useful, low-friction offer under 'Calls to action'.", weight: 5 });

  const banned = bullets(rules, /banned words/i).length + bullets(rules, /banned claims/i).length;
  add({ id: "rules", label: "Rules for copy", status: banned >= 3 ? "pass" : "warn", detail: `${banned} banned words or claims.`, fix: banned >= 3 ? undefined : "List the words and claims you never use in rules.md.", weight: 10 });

  const products = files.filter((f) => f.kind === "product" && f.path.endsWith(".md"));
  add({ id: "products", label: "One file per product", status: products.length ? "pass" : "fail", detail: `${products.length} product file(s).`, fix: products.length ? undefined : "Create products/<name>.md for each product.", weight: 10 });

  const notes = files.filter((f) => f.kind === "call-note" && /\.(md|txt)$/.test(f.path));
  add({ id: "call_notes", label: "Call notes with buyer quotes", status: notes.length >= 3 ? "pass" : notes.length ? "warn" : "fail", detail: `${notes.length} call note(s).`, fix: notes.length >= 3 ? undefined : "Save call notes in call-notes/ and keep the buyer's exact words as > quotes.", weight: 10 });

  const camps = files.filter((f) => f.kind === "campaign" && f.path.endsWith(".md"));
  const lastCamp = camps.map((c) => c.modifiedAt).sort().pop();
  add({
    id: "loop",
    label: "Campaign results written back",
    status: !camps.length ? "warn" : lastCamp && daysSince(lastCamp) > 14 ? "warn" : "pass",
    detail: camps.length ? `${camps.length} closed campaign(s), latest ${Math.round(daysSince(lastCamp!))} days ago.` : "No campaigns closed yet.",
    fix: !camps.length || (lastCamp && daysSince(lastCamp) > 14) ? "Run close_campaign every Monday on last week's campaigns." : undefined,
    weight: 10,
  });

  const ph = [...placeholdersIn(agents), ...placeholdersIn(offers), ...placeholdersIn(icp)];
  add({ id: "placeholders", label: "No unfilled placeholders", status: ph.length ? "warn" : "pass", detail: ph.length ? `Unfilled: ${ph.slice(0, 5).join(", ")}` : "All placeholders filled.", fix: ph.length ? "Replace the [bracketed] text in AGENTS.md and offers.md." : undefined, weight: 5 });

  const pending = listProposals(slug, "pending");
  const oldest = pending.map((p) => p.createdAt).sort()[0];
  add({
    id: "approvals",
    label: "Approval queue under control",
    status: !pending.length ? "pass" : oldest && daysSince(oldest) > 7 ? "warn" : "pass",
    detail: `${pending.length} change(s) waiting for the owner.`,
    fix: pending.length && oldest && daysSince(oldest) > 7 ? "Review the approval queue: a change has waited over a week." : undefined,
    weight: 5,
  });

  // Drift: recent wins that don't match the ICP's core traits.
  if (model) {
    const coreIds = new Set(model.traits.filter((t) => t.verdict === "core").map((t) => `${t.dimension}\u0000${t.value.toLowerCase()}`));
    const recent = deals(slug).filter((d) => d.outcome === "won" && d.closedAt && daysSince(d.closedAt) <= 120);
    if (coreIds.size && recent.length >= 3) {
      const off = recent.filter((d) => !dealTraits(d).some((t) => coreIds.has(`${t.dimension}\u0000${t.value.toLowerCase()}`)));
      const share = off.length / recent.length;
      add({
        id: "drift",
        label: "ICP still matches recent wins",
        status: share > 0.4 ? "fail" : share > 0.25 ? "warn" : "pass",
        detail: `${off.length} of ${recent.length} wins in the last 120 days match none of the core traits.`,
        fix: share > 0.25 ? `Your buyers may be shifting (${off.map((o) => o.company).slice(0, 3).join(", ")}). Rebuild the ICP.` : undefined,
        weight: 5,
      });
    }
  }

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0), 0);
  const score = Math.round((got / total) * 100);
  return { score, grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D", checks };
}
