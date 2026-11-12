"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { runTool, createClient, GtmError } from "@gtm/core";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === undefined ? undefined : Number(v);
};

async function who(f?: FormData): Promise<string> {
  const jar = await cookies();
  const typed = f ? str(f, "as") : undefined;
  if (typed) jar.set("gtm_user", typed, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return typed ?? jar.get("gtm_user")?.value ?? "web user";
}

/** Run a tool as the person using the web app, then come back to `back` with a message. */
async function act(back: string, name: string, input: Record<string, unknown>, ok: (r: any) => string, f?: FormData): Promise<never> {
  const actor = await who(f);
  const r = await runTool(name, input, { actor, human: true });
  revalidatePath("/", "layout");
  const sep = back.includes("?") ? "&" : "?";
  if (!r.ok) redirect(`${back}${sep}err=${encodeURIComponent(r.error)}`);
  redirect(`${back}${sep}msg=${encodeURIComponent(ok(r.result))}`);
}

export async function createClientAction(f: FormData) {
  const name = str(f, "name");
  const owner = str(f, "owner");
  let slug: string;
  try {
    if (!name || !owner) throw new GtmError("Give the client a name and a brain owner.");
    slug = createClient({ name, owner, website: str(f, "website"), creditBudget: num(f, "budget") }).slug;
  } catch (e) {
    redirect(`/?err=${encodeURIComponent((e as Error).message)}`);
  }
  redirect(`/c/${slug}?msg=${encodeURIComponent(`Created ${name}. Add closed-won.csv and closed-lost.csv to workspaces/${slug}/data/, then import.`)}`);
}

export async function importCrmAction(client: string, back: string) {
  return act(back, "import_crm", { client }, (r) => `Imported ${r.won} won, ${r.lost} lost, ${r.contacts} CRM contacts, ${r.targets} target accounts.${r.missing.length ? ` Missing: ${r.missing.join(", ")}` : ""}`);
}

export async function buildIcpAction(client: string, f: FormData) {
  return act(`/c/${client}/icp`, "build_icp", { client, apply: str(f, "apply") === "1" }, (r) => (r.applied ? "ICP rebuilt and applied." : r.proposalId ? `ICP rebuilt. Waiting for the owner: proposal #${r.proposalId}.` : "ICP rebuilt. No change to icp.md."), f);
}

export async function prospectAction(client: string, f: FormData) {
  return act(`/c/${client}/accounts`, "prospect_from_icp", { client, limit: num(f, "limit") ?? 25 }, (r) => `Found ${r.found} companies that match the ICP (${r.mode} data). Score them to rank.`);
}

export async function scoreAction(client: string, f: FormData) {
  return act(`/c/${client}/accounts`, "score_accounts", { client, refresh_signals: str(f, "refresh") === "1", one_batch: str(f, "one_batch") === "1" }, (r) =>
    r.progress.status === "paused" ? `Scored the first ${r.progress.done} of ${r.progress.total}. Check them, then score again to finish.` : `Scored ${r.progress.done} accounts: ${Object.entries(r.tiers).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
  );
}

export async function signalsAction(client: string, domain: string) {
  return act(`/c/${client}/accounts/${encodeURIComponent(domain)}`, "find_signals", { client, domain }, (r) => `${r.signals.length} signals (${r.added} new).`);
}

export async function rescoreOneAction(client: string, domain: string) {
  return act(`/c/${client}/accounts/${encodeURIComponent(domain)}`, "score_accounts", { client, domains: [domain] }, () => "Score updated.");
}

export async function peopleAction(client: string, domain: string, f: FormData) {
  const titles = str(f, "titles")?.split(",").map((s) => s.trim()).filter(Boolean);
  return act(`/c/${client}/accounts/${encodeURIComponent(domain)}`, "find_people", { client, domain, titles, limit: 5 }, (r) => `Found ${r.people.length} people.`);
}

export async function emailAction(client: string, domain: string, f: FormData) {
  return act(
    `/c/${client}/accounts/${encodeURIComponent(domain)}`,
    "enrich_contact",
    { client, domain, first_name: str(f, "first"), last_name: str(f, "last"), person_id: str(f, "id"), title: str(f, "title") },
    (r) => (r.suppressed ? `Skipped: ${r.suppressed}.` : r.email ? `${r.email}: ${r.status.replace("_", " ")}.` : `No email found (${r.status.replace("_", " ")}).`),
  );
}

export async function writeAction(client: string, f: FormData) {
  const domain = str(f, "domain");
  const actor = await who(f);
  const r = await runTool("write_email", { client, domain, contact_id: str(f, "contact_id"), first_name: str(f, "first"), last_name: str(f, "last"), title: str(f, "title"), angle: str(f, "angle") }, { actor, human: true });
  revalidatePath("/", "layout");
  if (!r.ok) redirect(`/c/${client}/writer?err=${encodeURIComponent(r.error)}`);
  const d = r.result as { id: number; verdict: string };
  redirect(`/c/${client}/writer?draft=${d.id}&msg=${encodeURIComponent(`Draft written: ${d.verdict.replace("_", " ")}.`)}`);
}

export async function closeCampaignAction(client: string, f: FormData) {
  return act(
    `/c/${client}/campaigns`,
    "close_campaign",
    {
      client,
      name: str(f, "name"),
      segment: str(f, "segment"),
      angle: str(f, "angle"),
      sent: num(f, "sent"),
      replies: num(f, "replies"),
      positive: num(f, "positive"),
      meetings: num(f, "meetings"),
      first_email: str(f, "first_email"),
      results_csv: str(f, "results_csv"),
    },
    (r) => `Closed and wrote ${r.file}.${r.proposal ? ` ICP learnings are waiting for the owner (proposal #${r.proposal.id}).` : ""}`,
    f,
  );
}

export async function decideAction(client: string, id: number, f: FormData) {
  const approve = str(f, "decision") === "approve";
  return act(`/c/${client}/approvals`, "decide_proposal", { client, id, approve, approver: str(f, "as") ?? "" }, (r) => `#${r.id} ${r.path} ${r.status}.`, f);
}

export async function proposeAction(client: string, f: FormData) {
  const path = str(f, "path") ?? "";
  return act(`/c/${client}/brain?file=${encodeURIComponent(path)}`, "propose_brain_change", { client, path, content: (f.get("content") as string) ?? "", reason: str(f, "reason") ?? "Edited in the web app" }, (r) => (r.proposalId ? `Change filed as proposal #${r.proposalId} for the owner.` : `Saved ${r.written}.`), f);
}

export async function rollbackAction(client: string, versionId: number) {
  return act(`/c/${client}/approvals`, "rollback_version", { client, version_id: versionId }, (r) => `Rollback filed as proposal #${r.proposalId}.`);
}
