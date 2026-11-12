import { z } from "zod";
import { listClients, getClient, readBrainFile, listBrainFiles, isProtected, writeBrainFile, GtmError } from "../brain/workspace";
import { brainHealth, loadIcpModel } from "../brain/health";
import { propose, listProposals, decideProposal, proposeRollback, listVersions } from "../brain/proposals";
import { importCrm } from "../crm";
import { getAccount, listAccounts, listContacts } from "../accounts";
import { DataGateway } from "../providers/gateway";
import { buildIcp, prospectFromIcp, scoreAccounts, writeEmail, lintText, closeCampaign, recommend, spendReport, clientOverview } from "../services";

export interface ToolContext {
  /** Who is calling: an agent name or a person. Used as the author of proposals. */
  actor: string;
  /** Set only by surfaces where a person acts directly (CLI, web UI buttons). */
  human?: boolean;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** true when the tool changes data or spends credits. */
  mutates: boolean;
  /** Only a person may run it (CLI / web UI). Hidden from AI agents (MCP, chat): a typed name is not proof of identity. */
  humanOnly?: boolean;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}

const client = z.string().describe("Client slug, e.g. 'acme'. Use list_clients to see them.");

function tool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const TOOLS = [
  tool({
    name: "list_clients",
    title: "List clients",
    description: "List every client brain with its owner and whether it uses sample or live data. Start here.",
    input: z.object({}),
    mutates: false,
    handler: () => listClients().map((c) => ({ slug: c.slug, name: c.name, owner: c.owner, demo: c.demo })),
  }),
  tool({
    name: "client_overview",
    title: "Client overview",
    description: "One-call snapshot of a client: brain health, ICP core traits, account tiers, contacts, drafts, campaign results, pending approvals and this month's spend.",
    input: z.object({ client }),
    mutates: false,
    handler: ({ client }) => clientOverview(client),
  }),
  tool({
    name: "read_brain",
    title: "Read the brain",
    description: "Without path: list the client's brain files. With path: return that file (e.g. icp.md, offers.md, rules.md, products/x.md, past-campaigns/...). Read icp.md, offers.md and rules.md before any GTM task.",
    input: z.object({ client, path: z.string().optional().describe("File path inside the brain folder") }),
    mutates: false,
    handler: ({ client, path }) => {
      getClient(client);
      if (!path) return listBrainFiles(client).map((f) => ({ path: f.path, kind: f.kind, bytes: f.bytes, modifiedAt: f.modifiedAt }));
      const content = readBrainFile(client, path);
      if (content === null) throw new GtmError(`${path} not found. Call read_brain without a path to list files.`, "not_found");
      return { path, content };
    },
  }),
  tool({
    name: "brain_health",
    title: "Brain health",
    description: "Score (0-100) how ready the brain is for agents, with each failing check and the exact fix.",
    input: z.object({ client }),
    mutates: false,
    handler: ({ client }) => brainHealth(client),
  }),
  tool({
    name: "import_crm",
    title: "Import CRM exports",
    description: "Import data/closed-won.csv, data/closed-lost.csv, data/crm-contacts.csv (suppression list) and data/target-accounts.csv from the client's brain folder.",
    input: z.object({ client }),
    mutates: true,
    handler: ({ client }) => importCrm(client),
  }),
  tool({
    name: "build_icp",
    title: "Build ICP from won/lost deals",
    description: "Compute statistical lift of every trait (industry, size, region, tools, signer seniority/function) in won vs lost deals and write icp.md with the numbers. Filed as a proposal for the owner unless the owner applies it.",
    input: z.object({ client, apply: z.boolean().optional().describe("Apply directly. Only works when the caller is the brain owner.") }),
    mutates: true,
    handler: async ({ client, apply }, ctx) => {
      const r = await buildIcp(client, { author: ctx.actor, apply });
      return {
        applied: r.applied,
        proposalId: r.proposal?.id ?? null,
        note: r.note,
        wins: r.model.nWon,
        losses: r.model.nLost,
        core: r.model.traits.filter((t) => t.verdict === "core").map((t) => ({ dimension: t.dimension, value: t.value, lift: t.lift, wins: t.won, losses: t.lost, confidence: t.confidence })),
        avoid: r.model.traits.filter((t) => t.verdict === "negative").map((t) => ({ dimension: t.dimension, value: t.value, lift: t.lift })),
        warnings: r.model.warnings,
        summaryBy: r.summaryBy,
      };
    },
  }),
  tool({
    name: "icp_model",
    title: "ICP statistics",
    description: "Return the full ICP lift table (every trait with wins, losses, lift, z-score, confidence and scoring weight).",
    input: z.object({ client }),
    mutates: false,
    handler: ({ client }) => loadIcpModel(client) ?? { error: "No ICP yet. Run build_icp." },
  }),
  tool({
    name: "prospect_from_icp",
    title: "Find accounts that match the ICP",
    description: "Turn the ICP into a company search (industries, size, regions, tools), save matches as accounts and flag existing customers or open deals.",
    input: z.object({
      client,
      limit: z.number().int().min(1).max(100).optional(),
      page: z.number().int().min(1).optional(),
      funded_since_year: z.number().int().min(2000).max(2100).optional().describe("Only companies funded in this year or later"),
    }),
    mutates: true,
    handler: ({ client, limit, page, funded_since_year }) => prospectFromIcp(client, { limit, page, fundedSinceYear: funded_since_year }),
  }),
  tool({
    name: "search_companies",
    title: "Search companies",
    description: "Search the data provider for companies and save them as accounts. Each result says if the CRM suppresses it.",
    input: z.object({
      client,
      keywords: z.array(z.string()).optional(),
      employee_ranges: z.array(z.string()).optional().describe('Ranges like "51,200"'),
      locations: z.array(z.string()).optional(),
      technologies: z.array(z.string()).optional(),
      funded_since_year: z.number().int().min(2000).max(2100).optional().describe("Only companies whose last funding round was in this year or later"),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    mutates: true,
    handler: async ({ client, keywords, employee_ranges, locations, technologies, funded_since_year, limit }) => {
      const gw = new DataGateway(client);
      const res = await gw.searchCompanies({ keywords, employeeRanges: employee_ranges, locations, technologies, fundedSinceYear: funded_since_year, limit: limit ?? 25 });
      return { mode: gw.status.mode, count: res.length, companies: res.map((c) => ({ name: c.name, domain: c.domain, industry: c.industry, employees: c.employees, region: c.region, suppressed: c.suppressed })) };
    },
  }),
  tool({
    name: "find_signals",
    title: "Find buying signals",
    description: "Enrich one account and collect buying signals (funding, hiring for go-to-market roles, new leaders, headcount growth, new tools). Signals are saved on the account.",
    input: z.object({ client, domain: z.string() }),
    mutates: true,
    handler: async ({ client, domain }) => {
      const gw = new DataGateway(client);
      const r = await gw.findSignals(domain);
      return { mode: gw.status.mode, company: r.company?.name ?? null, added: r.added, signals: r.signals };
    },
  }),
  tool({
    name: "score_accounts",
    title: "Score and tier accounts",
    description: "Score accounts 0-100 (ICP fit 0-60 + signal intent 0-40, decayed by age) into Tier 1/2/3 with reasons. Existing customers and open deals are suppressed. Runs in checkpointed batches of 100.",
    input: z.object({
      client,
      domains: z.array(z.string()).optional().describe("Only these accounts. Omit for all."),
      refresh_signals: z.boolean().optional().describe("Fetch fresh signals first (uses credits in live mode)"),
      one_batch: z.boolean().optional().describe("Stop after the first 100 so a person can check them"),
    }),
    mutates: true,
    handler: ({ client, domains, refresh_signals, one_batch }) => scoreAccounts(client, { domains, refreshSignals: refresh_signals, stopAfterBatches: one_batch ? 1 : undefined }),
  }),
  tool({
    name: "top_accounts",
    title: "Top accounts",
    description: "List scored accounts, best first, with tier, score and the reasons behind it.",
    input: z.object({ client, tier: z.enum(["Tier 1", "Tier 2", "Tier 3"]).optional(), limit: z.number().int().min(1).max(200).optional() }),
    mutates: false,
    handler: ({ client, tier, limit }) =>
      listAccounts(client, { tier, limit: limit ?? 20 }).map((a) => ({ name: a.name, domain: a.domain, tier: a.tier, score: a.score, fit: a.fit, intent: a.intent, reasons: a.reasons, signals: a.signals.slice(0, 3).map((s) => s.title) })),
  }),
  tool({
    name: "account_detail",
    title: "Account detail",
    description: "Everything known about one account: firmographics, signals, score reasons, contacts and their email status.",
    input: z.object({ client, domain: z.string() }),
    mutates: false,
    handler: ({ client, domain }) => {
      const a = getAccount(client, domain);
      if (!a) throw new GtmError(`No account ${domain}`, "not_found");
      return { ...a, contacts: listContacts(client, domain) };
    },
  }),
  tool({
    name: "find_people",
    title: "Find people at an account",
    description: "Find buyers at a company by title. Free in Apollo (no emails); use enrich_contact for the email.",
    input: z.object({ client, domain: z.string(), titles: z.array(z.string()).optional(), limit: z.number().int().min(1).max(25).optional() }),
    mutates: true,
    handler: async ({ client, domain, titles, limit }) => {
      const gw = new DataGateway(client);
      const people = await gw.findPeople(domain, titles, limit ?? 5);
      return { mode: gw.status.mode, people: people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, firstName: p.firstName, lastName: p.lastName, title: p.title, seniority: p.seniority, suppressed: p.suppressed })) };
    },
  }),
  tool({
    name: "enrich_contact",
    title: "Find and verify an email",
    description: "Email waterfall: Apollo match (stops if verified) then email finder then verifier. Returns the email, its status (verified / catch_all / risky / invalid / not_found) and every step with credits used.",
    input: z.object({ client, domain: z.string(), first_name: z.string(), last_name: z.string(), person_id: z.string().optional(), title: z.string().optional() }),
    mutates: true,
    handler: async ({ client, domain, first_name, last_name, person_id, title }) => {
      const gw = new DataGateway(client);
      return { mode: gw.status.mode, ...(await gw.findEmail({ id: person_id, firstName: first_name, lastName: last_name, domain, title })) };
    },
  }),
  tool({
    name: "write_email",
    title: "Write a first email with a claim ledger",
    description: "Write a first cold email for an account from its strongest signal. Every sentence is checked against numbered sources (signals, proof, products, call-note quotes) and rules.md. Verdict: ready, needs_review or blocked.",
    input: z.object({
      client,
      domain: z.string(),
      contact_id: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      title: z.string().optional(),
      angle: z.string().optional(),
      signal_index: z.number().int().min(0).optional(),
    }),
    mutates: true,
    handler: ({ client, domain, contact_id, first_name, last_name, title, angle, signal_index }) =>
      writeEmail(client, { domain, contactId: contact_id, contact: first_name ? { firstName: first_name, lastName: last_name, title } : undefined, angle, signalIndex: signal_index }),
  }),
  tool({
    name: "lint_copy",
    title: "Check copy against rules.md",
    description: "Check any email text against the client's rules.md: word limit, links, banned words and claims, spam triggers, AI tells, placeholders.",
    input: z.object({ client, text: z.string() }),
    mutates: false,
    handler: ({ client, text }) => lintText(client, text),
  }),
  tool({
    name: "close_campaign",
    title: "Close a campaign",
    description: "Write a finished campaign into past-campaigns/ with results by segment, recompute which segments win (Bayesian), and propose ICP learnings for the owner to approve. Give totals or results_csv (a per-recipient export in data/).",
    input: z.object({
      client,
      name: z.string(),
      segment: z.string().optional(),
      angle: z.string().optional(),
      sent: z.number().int().min(0).optional(),
      replies: z.number().int().min(0).optional(),
      positive: z.number().int().min(0).optional(),
      meetings: z.number().int().min(0).optional(),
      first_email: z.string().optional(),
      notes: z.string().optional(),
      results_csv: z.string().optional().describe("e.g. data/campaign-results.csv"),
    }),
    mutates: true,
    handler: (i, ctx) =>
      closeCampaign(i.client, { name: i.name, segment: i.segment, angle: i.angle, sent: i.sent, replies: i.replies, positive: i.positive, meetings: i.meetings, firstEmail: i.first_email, notes: i.notes, resultsCsv: i.results_csv, author: ctx.actor }),
  }),
  tool({
    name: "recommend_segments",
    title: "Recommend next segments",
    description: "From every closed campaign: positive-reply rate per segment and angle, probability each is best, and the next 3 segments to scale, test, explore or stop.",
    input: z.object({ client }),
    mutates: false,
    handler: ({ client }) => recommend(client),
  }),
  tool({
    name: "propose_brain_change",
    title: "Propose a brain change",
    description: "Propose new content for a brain file. icp.md, offers.md, rules.md, AGENTS.md and products/ only change after the owner approves. Logs (call-notes/, data/) are written directly.",
    input: z.object({ client, path: z.string(), content: z.string(), reason: z.string() }),
    mutates: true,
    handler: ({ client, path, content, reason }, ctx) => {
      if (!isProtected(path)) {
        writeBrainFile(client, path, content, ctx.actor, reason);
        return { written: path, note: "Not a protected file, so it was written directly." };
      }
      const p = propose(client, path, content, reason, ctx.actor);
      return { proposalId: p.id, path: p.path, added: p.stats.added, removed: p.stats.removed, status: p.status };
    },
  }),
  tool({
    name: "list_proposals",
    title: "List proposals",
    description: "List brain changes waiting for the owner (or all), with a line diff.",
    input: z.object({ client, status: z.enum(["pending", "approved", "rejected", "superseded", "all"]).optional() }),
    mutates: false,
    handler: ({ client, status }) =>
      listProposals(client, status ?? "pending").map((p) => ({
        id: p.id,
        path: p.path,
        reason: p.reason,
        author: p.author,
        status: p.status,
        createdAt: p.createdAt,
        added: p.stats.added,
        removed: p.stats.removed,
        diff: p.diff.filter((d) => d.op !== "same").slice(0, 60).map((d) => `${d.op === "add" ? "+" : "-"} ${d.text}`),
      })),
  }),
  tool({
    name: "decide_proposal",
    title: "Approve or reject a proposal",
    description: "Approve or reject a proposed brain change. Only the client's brain owner can do this; pass their name as approver.",
    input: z.object({ client, id: z.number().int(), approve: z.boolean(), approver: z.string().describe("Name of the brain owner") }),
    mutates: true,
    humanOnly: true,
    handler: ({ client, id, approve, approver }) => {
      const p = decideProposal(client, id, approve, approver);
      return { id: p.id, path: p.path, status: p.status, decidedBy: p.decidedBy };
    },
  }),
  tool({
    name: "brain_history",
    title: "Brain history",
    description: "Version history of brain files. Use rollback_version to propose restoring an old version.",
    input: z.object({ client, path: z.string().optional() }),
    mutates: false,
    handler: ({ client, path }) => listVersions(client, path),
  }),
  tool({
    name: "rollback_version",
    title: "Propose a rollback",
    description: "Propose restoring a brain file to an earlier version (the owner still approves).",
    input: z.object({ client, version_id: z.number().int() }),
    mutates: true,
    handler: ({ client, version_id }, ctx) => {
      const p = proposeRollback(client, version_id, ctx.actor);
      return { proposalId: p.id, path: p.path };
    },
  }),
  tool({
    name: "spend_report",
    title: "Spend report",
    description: "Credits and dollars spent this month by provider and action, cache hit rate and remaining budget.",
    input: z.object({ client }),
    mutates: false,
    handler: ({ client }) => spendReport(client),
  }),
];

export type AnyTool = (typeof TOOLS)[number];

export function findTool(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Validate and run a tool. Errors come back as { error, code } so every surface reports them the same way. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ ok: true; result: unknown } | { ok: false; error: string; code: string }> {
  const t = findTool(name);
  if (!t) return { ok: false, error: `Unknown tool ${name}`, code: "unknown_tool" };
  if (t.humanOnly && !ctx.human) return { ok: false, error: `${name} can only be run by a person (web app or gtm CLI), not by an AI agent.`, code: "human_only" };
  const parsed = t.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`, code: "invalid_input" };
  try {
    const result = await (t.handler as (i: unknown, c: ToolContext) => unknown)(parsed.data, ctx);
    return { ok: true, result };
  } catch (e) {
    const code = e instanceof GtmError ? e.code : "error";
    return { ok: false, error: e instanceof Error ? e.message : String(e), code };
  }
}

/** JSON Schema for each tool, for the Claude API tool list. */
/** Tools an AI agent may call (everything except human-only approvals). */
export const AGENT_TOOLS = TOOLS.filter((t) => !t.humanOnly);

export function toolJsonSchemas() {
  return AGENT_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}
