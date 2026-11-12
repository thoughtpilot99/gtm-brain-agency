import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { all, get, json, now, run } from "./db";
import { GtmError, getClient, listBrainFiles, listDir, readBrainFile, safePath, writeBrainFile } from "./brain/workspace";
import { bullets } from "./brain/markdown";
import { propose, listProposals } from "./brain/proposals";
import { brainHealth, loadIcpModel } from "./brain/health";
import { crmStats, deals, suppressionReason } from "./crm";
import { getAccount, listAccounts, listContacts, saveScore, upsertAccount } from "./accounts";
import { buildIcpModel, renderIcpMarkdown, DIMENSION_LABELS, type IcpModel } from "./engines/icp-lift";
import { scoreAccount } from "./engines/scoring";
import { lintCopy, parseRules } from "./engines/rules-lint";
import { DraftSchema, buildSources, finalizeDraft, templateDraft, writerPrompt, type DraftResult, type WriterContext } from "./engines/writer";
import { recommendSegments, segmentPosteriors, type CampaignStat } from "./engines/campaign-learn";
import { runBatches } from "./engines/batch";
import { DataGateway, mergeSignals, providerStatus, spentThisMonth } from "./providers/gateway";
import { NON_BUYER_INDUSTRIES, SIZE_BUCKETS, industryMatches, normalizeDomain, sizeBucket, slugify } from "./traits";
import { parseCsv } from "./csv";
import { generateJson, llmAvailable, LlmError } from "./llm";

// ---------- ICP ----------

export function saveIcpModel(slug: string, model: IcpModel) {
  const p = safePath(slug, ".brain/icp-model.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(model, null, 2), "utf8");
}

export async function buildIcp(slug: string, opts: { author: string; apply?: boolean; narrate?: boolean }) {
  const client = getClient(slug);
  const rows = deals(slug);
  if (!rows.length) throw new GtmError("No deals imported. Put closed-won.csv and closed-lost.csv in data/ and run import_crm first.", "no_data");
  const model = buildIcpModel(rows);
  saveIcpModel(slug, model);
  let summary: string | undefined;
  let summaryBy: "claude" | "none" = "none";
  if (opts.narrate !== false && llmAvailable()) {
    const top = model.traits.filter((t) => t.verdict !== "neutral").slice(0, 14);
    try {
      const out = await generateJson(z.object({ summary: z.string() }), {
        slug,
        action: "icp_summary",
        effort: "low",
        maxTokens: 4000,
        system: "You summarise ICP statistics for a sales team. Use only the numbers given. Never add a fact, a company name or a number that is not in the data. 3 to 4 plain sentences.",
        prompt: `Client: ${client.name}\nWins: ${model.nWon}, losses: ${model.nLost}, baseline win rate ${Math.round(model.baselineWinRate * 100)}%.\nTraits (dimension | value | wins | losses | lift | verdict):\n${top
          .map((t) => `${DIMENSION_LABELS[t.dimension] ?? t.dimension} | ${t.value} | ${t.won} | ${t.lost} | ${t.lift}x | ${t.verdict}`)
          .join("\n")}`,
      });
      summary = out.summary;
      summaryBy = "claude";
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
    }
  }
  const markdown = renderIcpMarkdown(model, { clientName: client.name, summary });
  const isOwner = opts.author.trim().toLowerCase() === client.owner.trim().toLowerCase();
  if (opts.apply && isOwner) {
    writeBrainFile(slug, "icp.md", markdown, opts.author, "ICP rebuilt from CRM data");
    return { model, markdown, applied: true, proposal: null, summaryBy };
  }
  const current = readBrainFile(slug, "icp.md") ?? "";
  const proposal = current === markdown ? null : propose(slug, "icp.md", markdown, `ICP rebuilt from ${model.nWon} wins and ${model.nLost} losses`, opts.author);
  return { model, markdown, applied: false, proposal, summaryBy, note: opts.apply && !isOwner ? `Only the owner (${client.owner}) can apply directly, so this was filed as a proposal.` : undefined };
}

/** Vendor industries that are rarely buyers of B2B software. Sent as exclusions unless the ICP says otherwise. */
const NON_BUYER_EXCLUDES = [
  "Advertising Services",
  "Marketing Services",
  "Venture Capital and Private Equity Principals",
  "Higher Education",
  "Staffing and Recruiting",
  "Business Consulting and Services",
  "Non-profit Organizations",
  "Government Administration",
  "Think Tanks",
  "Civic and Social Organizations",
  "Professional Training and Coaching",
];

export function icpQuery(model: IcpModel) {
  const sizes = (model.profile.company_size ?? []).map((s) => SIZE_BUCKETS.find((b) => b.label === s)?.apollo).filter((x): x is string => !!x);
  return {
    industries: (model.profile.industry ?? []).slice(0, 4),
    employeeRanges: sizes,
    locations: (model.profile.region ?? []).flatMap((r) => (r === "North America" ? ["United States", "Canada"] : r === "UK & Ireland" ? ["United Kingdom", "Ireland"] : [r])),
    technologies: (model.profile.tech ?? []).slice(0, 4),
    ...icpExclusions(model),
  };
}

/** The ICP's bad-fit industries plus common non-buyers, except any the ICP marks as a good fit. */
export function icpExclusions(model: IcpModel): { excludeKeywords: string[]; excludeIndustries: string[] } {
  const good = model.profile.industry ?? [];
  const bad = model.traits.filter((t) => t.dimension === "industry" && t.verdict === "negative").map((t) => t.value);
  const excludeIndustries = NON_BUYER_EXCLUDES.filter((v) => !good.some((g) => industryMatches(g, v)));
  return { excludeKeywords: [...bad, ...(good.some((g) => /agency|consult/i.test(g)) ? [] : ["agency"])].slice(0, 15), excludeIndustries };
}

/** Local backstop: drops results the provider let through that are non-buyers or the ICP's bad-fit industries. */
export function isBadFit(model: IcpModel, c: { industry?: string; description?: string }): string | null {
  const good = model.profile.industry ?? [];
  if (c.industry && NON_BUYER_INDUSTRIES.test(c.industry) && !good.some((g) => industryMatches(g, c.industry))) return c.industry;
  for (const t of model.traits.filter((x) => x.dimension === "industry" && x.verdict === "negative")) {
    if (industryMatches(t.value, c.industry) === "industry") return t.value;
  }
  return null;
}

/** Turn the ICP into a company search and save the results as accounts. */
export async function prospectFromIcp(slug: string, opts: { limit?: number; page?: number; fundedSinceYear?: number } = {}) {
  const model = loadIcpModel(slug);
  if (!model) throw new GtmError("Build the ICP first (build_icp).", "no_icp");
  const gw = new DataGateway(slug);
  const q = { ...icpQuery(model), fundedSinceYear: opts.fundedSinceYear, limit: opts.limit ?? 25, page: opts.page ?? 1 };
  let raw = await gw.searchCompanies(q, false);
  let relaxed = false;
  if (raw.length < 5 && q.technologies.length) {
    raw = await gw.searchCompanies({ ...q, technologies: [] }, false);
    relaxed = true;
  }
  const dropped: { name: string; domain: string; reason: string }[] = [];
  const companies = raw.filter((c) => {
    const why = isBadFit(model, c);
    if (why) dropped.push({ name: c.name, domain: c.domain, reason: why });
    return !why;
  });
  for (const c of companies) upsertAccount(slug, { ...c, signals: mergeSignals(getAccount(slug, c.domain)?.signals ?? [], c.signals ?? []).signals });
  return { query: q, relaxedTechFilter: relaxed, mode: gw.status.mode, found: companies.length, dropped, companies: companies.map((c) => ({ name: c.name, domain: c.domain, industry: c.industry, employees: c.employees, region: c.region, suppressed: c.suppressed })) };
}

// ---------- Scoring ----------

export async function scoreAccounts(slug: string, opts: { domains?: string[]; refreshSignals?: boolean; stopAfterBatches?: number; jobId?: string } = {}) {
  getClient(slug);
  const model = loadIcpModel(slug);
  const accounts = opts.domains?.length
    ? opts.domains.map((d) => getAccount(slug, d)).filter((a): a is NonNullable<typeof a> => !!a)
    : listAccounts(slug, { includeSuppressed: true, limit: 5000 });
  if (!accounts.length) throw new GtmError("No accounts to score. Import target-accounts.csv or run prospect_from_icp.", "no_accounts");
  const errors: string[] = [];
  let gw = opts.refreshSignals ? new DataGateway(slug) : null;
  if (gw?.status.mode === "off") {
    errors.push(`Signals not refreshed: ${gw.status.reason}. Scored on ICP fit only.`);
    gw = null;
  }
  const jobId = opts.jobId ?? `score:${slug}:${accounts.length}:${opts.refreshSignals ? "sig" : "nosig"}`;
  const progress = await runBatches(slug, jobId, "score", accounts, async (batch) => {
    for (const a of batch) {
      let acc = a;
      if (gw) {
        try {
          await gw.findSignals(a.domain);
          acc = getAccount(slug, a.domain) ?? a;
        } catch (e) {
          if (e instanceof GtmError && e.code === "budget_exceeded") throw e;
          errors.push(`${a.domain}: ${(e as Error).message}`);
        }
      }
      const s = scoreAccount(acc, model, suppressionReason(slug, acc.domain));
      saveScore(slug, acc.domain, s);
    }
  }, { stopAfterBatches: opts.stopAfterBatches });
  const scored = (opts.domains?.length ? opts.domains.map((d) => getAccount(slug, d)!).filter(Boolean) : listAccounts(slug, { includeSuppressed: true, limit: 5000 }));
  const tiers: Record<string, number> = {};
  for (const a of scored) tiers[a.tier ?? "Unscored"] = (tiers[a.tier ?? "Unscored"] ?? 0) + 1;
  return {
    progress,
    usedIcp: !!model,
    tiers,
    top: scored
      .filter((a) => a.tier !== "Suppressed")
      .slice(0, 10)
      .map((a) => ({ name: a.name, domain: a.domain, score: a.score, tier: a.tier, why: a.reasons.slice(0, 4) })),
    errors: errors.slice(0, 10),
  };
}

// ---------- Writing ----------

function writerContext(slug: string, domain: string, opts: { contact?: WriterContext["contact"]; angle?: string; signalIndex?: number }): WriterContext {
  const client = getClient(slug);
  const account = getAccount(slug, domain);
  if (!account) throw new GtmError(`No account ${domain}. Search or import it first.`, "no_account");
  const model = loadIcpModel(slug);
  const rules = readBrainFile(slug, "rules.md") ?? "";
  const productFiles = listDir(slug, "products").filter((p) => p.endsWith(".md"));
  const noteFiles = listDir(slug, "call-notes").filter((p) => /\.(md|txt)$/.test(p));
  const icpSummary = (account.reasons ?? []).filter((r) => r.startsWith("+ ")).map((r) => r.slice(2)).slice(0, 4);
  return {
    clientName: client.name,
    account,
    contact: opts.contact,
    angle: opts.angle,
    signalIndex: opts.signalIndex,
    offersMd: readBrainFile(slug, "offers.md") ?? "",
    productsMd: productFiles.map((p) => readBrainFile(slug, p) ?? ""),
    callNotesMd: noteFiles.slice(0, 10).map((p) => readBrainFile(slug, p) ?? ""),
    icpSummary: icpSummary.length ? icpSummary : model ? Object.entries(model.profile).map(([k, v]) => `${DIMENSION_LABELS[k] ?? k}: ${v.slice(0, 2).join(", ")}`) : [],
    voice: bullets(rules, /voice/i),
    rules: parseRules(rules),
  };
}

export async function writeEmail(
  slug: string,
  opts: { domain: string; contactId?: string; contact?: { firstName: string; lastName?: string; title?: string }; angle?: string; signalIndex?: number; useClaude?: boolean },
): Promise<DraftResult & { id: number; suppressed: string | null }> {
  const domain = normalizeDomain(opts.domain);
  let contact = opts.contact;
  if (opts.contactId) {
    const c = listContacts(slug, domain).find((x) => x.id === opts.contactId);
    if (c) contact = { firstName: c.firstName, lastName: c.lastName, title: c.title };
  }
  const ctx = writerContext(slug, domain, { contact, angle: opts.angle, signalIndex: opts.signalIndex });
  const sources = buildSources(ctx);
  let result: DraftResult | null = null;
  if (opts.useClaude !== false && llmAvailable()) {
    let feedback: string[] | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { system, prompt } = writerPrompt(ctx, sources, feedback);
        const out = await generateJson(DraftSchema, { slug, action: "write_email", system, prompt, effort: "medium", maxTokens: 8000 });
        result = finalizeDraft(out.subject, out.sentences, sources, ctx, "claude", attempt);
        if (result.verdict !== "blocked") break;
        feedback = [
          ...result.claims.filter((c) => !c.supported).flatMap((c) => c.problems.map((p) => `"${c.sentence}": ${p}`)),
          ...result.lint.issues.filter((i) => i.severity === "error").map((i) => i.message),
        ];
      } catch (e) {
        if (!(e instanceof LlmError)) throw e;
        break;
      }
    }
  }
  if (!result) {
    const t = templateDraft(ctx, sources);
    result = finalizeDraft(t.subject, t.sentences, sources, ctx, "template", 0);
  }
  const { lastInsertRowid } = run(
    "INSERT INTO drafts (client, domain, contact_id, subject, body, sentences, sources, lint, verdict, writer, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    slug,
    domain,
    opts.contactId ?? null,
    result.subject,
    result.body,
    JSON.stringify({ sentences: result.sentences, claims: result.claims }),
    JSON.stringify(result.sources),
    JSON.stringify(result.lint),
    result.verdict,
    result.writer,
    now(),
  );
  return { ...result, id: lastInsertRowid, suppressed: suppressionReason(slug, domain) };
}

export function listDrafts(slug: string, limit = 50) {
  return all<Record<string, unknown>>("SELECT * FROM drafts WHERE client = ? ORDER BY id DESC LIMIT ?", slug, limit).map((r) => {
    const s = json<{ sentences: unknown[]; claims: unknown[] }>(r.sentences, { sentences: [], claims: [] });
    return {
      id: r.id as number,
      domain: r.domain as string,
      contactId: r.contact_id as string | null,
      subject: r.subject as string,
      body: r.body as string,
      sentences: s.sentences,
      claims: s.claims,
      sources: json<unknown[]>(r.sources, []),
      lint: json<unknown>(r.lint, {}),
      verdict: r.verdict as string,
      writer: r.writer as string,
      createdAt: r.created_at as string,
    };
  });
}

export function lintText(slug: string, text: string) {
  return lintCopy(text, parseRules(readBrainFile(slug, "rules.md") ?? ""));
}

// ---------- Campaign loop ----------

const truthy = (v: string | undefined) => /^(1|y|yes|true|x)$/i.test((v ?? "").trim());

export interface CloseCampaignInput {
  name: string;
  segment?: string;
  angle?: string;
  sent?: number;
  replies?: number;
  positive?: number;
  meetings?: number;
  firstEmail?: string;
  notes?: string;
  /** Per-recipient export in data/, e.g. data/campaign-results.csv (email,domain,industry,employees,title,replied,positive,meeting). */
  resultsCsv?: string;
  author: string;
}

export function closeCampaign(slug: string, input: CloseCampaignInput) {
  const client = getClient(slug);
  let stats: CampaignStat[] = [];
  if (input.resultsCsv) {
    const p = safePath(slug, input.resultsCsv);
    if (!fs.existsSync(p)) throw new GtmError(`${input.resultsCsv} not found in the brain folder`, "not_found");
    const rows = parseCsv(fs.readFileSync(p, "utf8"));
    const groups = new Map<string, CampaignStat>();
    for (const r of rows) {
      const seg = r.segment || [r.industry || "Unknown industry", sizeBucket(Number(r.employees)) ?? "unknown size"].join(" · ");
      const g = groups.get(seg) ?? { segment: seg, angle: input.angle, sent: 0, replies: 0, positive: 0, meetings: 0 };
      g.sent++;
      if (truthy(r.replied)) g.replies++;
      if (truthy(r.positive)) g.positive++;
      if (truthy(r.meeting)) g.meetings++;
      groups.set(seg, g);
    }
    stats = [...groups.values()];
  } else {
    if (!input.sent || input.sent <= 0) throw new GtmError("Give sent, replies, positive and meetings, or a resultsCsv export.", "bad_request");
    stats = [{ segment: input.segment || "Unlabelled", angle: input.angle, sent: input.sent, replies: input.replies ?? 0, positive: input.positive ?? 0, meetings: input.meetings ?? 0 }];
  }
  const date = new Date().toISOString().slice(0, 10);
  const file = `past-campaigns/${date}-${slugify(input.name) || "campaign"}.md`;
  for (const s of stats) {
    run(
      "INSERT INTO campaigns (client, name, segment, angle, sent, replies, positive, meetings, first_email, notes, file, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      slug,
      input.name,
      s.segment,
      s.angle ?? null,
      s.sent,
      s.replies,
      s.positive,
      s.meetings,
      input.firstEmail ?? null,
      input.notes ?? null,
      file,
      now(),
    );
  }
  const rec = recommend(slug);
  const tot = stats.reduce((a, s) => ({ sent: a.sent + s.sent, replies: a.replies + s.replies, positive: a.positive + s.positive, meetings: a.meetings + s.meetings }), { sent: 0, replies: 0, positive: 0, meetings: 0 });
  const rate = (x: number) => (tot.sent ? `${Math.round((x / tot.sent) * 1000) / 10}%` : "0%");
  const bestHere = [...stats].sort((a, b) => b.positive / Math.max(1, b.sent) - a.positive / Math.max(1, a.sent));
  const md = [
    `# ${input.name}`,
    "",
    `Closed ${date}${input.angle ? ` · Angle: ${input.angle}` : ""}`,
    "",
    "## Results",
    `- Emails sent: ${tot.sent}`,
    `- Replies: ${tot.replies} (${rate(tot.replies)})`,
    `- Positive replies: ${tot.positive} (${rate(tot.positive)})`,
    `- Meetings: ${tot.meetings}`,
    "",
    "## By segment",
    "| Segment | Sent | Replies | Positive | Meetings |",
    "|---|---|---|---|---|",
    ...stats.map((s) => `| ${s.segment} | ${s.sent} | ${s.replies} | ${s.positive} | ${s.meetings} |`),
    "",
    "## First email",
    input.firstEmail ? input.firstEmail.split(/\r?\n/).map((l) => `> ${l}`).join("\n") : "not found",
    "",
    "## What to repeat",
    `- ${bestHere[0] ? `${bestHere[0].segment}: ${bestHere[0].positive}/${bestHere[0].sent} positive.` : "not found"}`,
    "## What to change",
    `- ${bestHere.length > 1 ? `${bestHere[bestHere.length - 1].segment}: ${bestHere[bestHere.length - 1].positive}/${bestHere[bestHere.length - 1].sent} positive.` : input.notes || "not found"}`,
    "## Next 3 segments to try",
    ...rec.recommendations.slice(0, 3).map((r) => `- ${r.segment} (${r.action}): ${r.why}`),
    "",
    input.notes ? `## Notes\n${input.notes}\n` : "",
  ].join("\n");
  writeBrainFile(slug, file, md, input.author, `campaign closed: ${input.name}`);

  // Suggest a brain update; the owner approves it.
  const icp = readBrainFile(slug, "icp.md") ?? "";
  const learnings = rec.posteriors
    .filter((p) => p.sent >= 50)
    .slice(0, 5)
    .map((p) => `- ${p.segment}: ${p.positive}/${p.sent} positive (${Math.round(p.positiveRate * 1000) / 10}%), ${Math.round(p.pBest * 100)}% chance it is the best segment.`);
  let proposal = null;
  if (learnings.length) {
    const block = `## Campaign learnings (updated ${date})\n${learnings.join("\n")}\n`;
    const next = /## Campaign learnings[\s\S]*?(?=\n## |\s*$)/.test(icp)
      ? icp.replace(/## Campaign learnings[\s\S]*?(?=\n## |\s*$)/, block.trimEnd())
      : icp.replace(/\n## Sources/, `\n${block}\n## Sources`) + (icp.includes("## Sources") ? "" : `\n${block}`);
    if (next !== icp) {
      try {
        proposal = propose(slug, "icp.md", next, `Campaign "${input.name}" closed: update learnings`, input.author);
      } catch (e) {
        if (!(e instanceof GtmError)) throw e;
      }
    }
  }
  return { client: client.name, file, totals: tot, segments: stats, recommendations: rec.recommendations.slice(0, 3), proposal };
}

export function recommend(slug: string) {
  const rows = all<CampaignStat>("SELECT segment, angle, sent, replies, positive, meetings FROM campaigns WHERE client = ?", slug);
  const posteriors = segmentPosteriors(rows, "segment");
  const angles = segmentPosteriors(rows, "angle");
  const model = loadIcpModel(slug);
  const tested = new Set(posteriors.map((p) => p.segment.toLowerCase()));
  const untested: string[] = [];
  if (model) {
    for (const ind of model.profile.industry ?? []) for (const size of model.profile.company_size ?? [ "" ]) {
      const seg = [ind, size].filter(Boolean).join(" · ");
      if (!tested.has(seg.toLowerCase())) untested.push(seg);
    }
  }
  return { posteriors, angles, recommendations: recommendSegments(posteriors, untested), campaigns: rows.length };
}

export function listCampaigns(slug: string) {
  return all<Record<string, unknown>>("SELECT * FROM campaigns WHERE client = ? ORDER BY id DESC", slug);
}

// ---------- Overview & spend ----------

export function spendReport(slug: string) {
  const client = getClient(slug);
  const month = spentThisMonth(slug);
  const byProvider = all<{ provider: string; action: string; calls: number; cached: number; credits: number; usd: number }>(
    `SELECT provider, action, COUNT(*) AS calls, SUM(cached) AS cached, SUM(credits) AS credits, SUM(usd) AS usd
     FROM ledger WHERE client = ? GROUP BY provider, action ORDER BY usd DESC, credits DESC`,
    slug,
  ).map((r) => ({ ...r, calls: Number(r.calls), cached: Number(r.cached), credits: Math.round(Number(r.credits) * 1000) / 1000, usd: Math.round(Number(r.usd) * 10000) / 10000 }));
  const totalCalls = byProvider.reduce((s, r) => s + r.calls, 0);
  const cachedCalls = byProvider.reduce((s, r) => s + r.cached, 0);
  const daily = all<{ day: string; credits: number; usd: number }>(
    "SELECT substr(created_at, 1, 10) AS day, SUM(credits) AS credits, SUM(usd) AS usd FROM ledger WHERE client = ? AND cached = 0 GROUP BY day ORDER BY day DESC LIMIT 30",
    slug,
  ).map((d) => ({ day: d.day, credits: Math.round(Number(d.credits) * 1000) / 1000, usd: Math.round(Number(d.usd) * 10000) / 10000 }));
  const recent = all<Record<string, unknown>>("SELECT provider, action, credits, usd, cached, meta, created_at FROM ledger WHERE client = ? ORDER BY id DESC LIMIT 40", slug);
  return {
    budget: client.creditBudget,
    month: { credits: Math.round(month.credits * 100) / 100, usd: Math.round(month.usd * 100) / 100 },
    remaining: Math.max(0, Math.round((client.creditBudget - month.credits) * 100) / 100),
    cacheHitRate: totalCalls ? Math.round((cachedCalls / totalCalls) * 1000) / 10 : 0,
    byProvider,
    daily: daily.reverse(),
    recent,
  };
}

export function clientOverview(slug: string) {
  const client = getClient(slug);
  const accounts = listAccounts(slug, { includeSuppressed: true, limit: 5000 });
  const tiers: Record<string, number> = {};
  for (const a of accounts) tiers[a.tier ?? "Unscored"] = (tiers[a.tier ?? "Unscored"] ?? 0) + 1;
  const health = brainHealth(slug);
  const model = loadIcpModel(slug);
  const contacts = Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE client = ?", slug)?.n ?? 0);
  const verified = Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM contacts WHERE client = ? AND email_status = 'verified'", slug)?.n ?? 0);
  const drafts = all<{ verdict: string; n: number }>("SELECT verdict, COUNT(*) AS n FROM drafts WHERE client = ? GROUP BY verdict", slug);
  const camp = get<{ sent: number; positive: number; meetings: number; n: number }>(
    "SELECT SUM(sent) AS sent, SUM(positive) AS positive, SUM(meetings) AS meetings, COUNT(DISTINCT name) AS n FROM campaigns WHERE client = ?",
    slug,
  );
  return {
    client,
    providers: providerStatus(client),
    health: { score: health.score, grade: health.grade, failing: health.checks.filter((c) => c.status !== "pass").map((c) => ({ label: c.label, fix: c.fix })) },
    crm: crmStats(slug),
    icp: model ? { builtAt: model.builtAt, nWon: model.nWon, nLost: model.nLost, core: model.traits.filter((t) => t.verdict === "core").map((t) => `${DIMENSION_LABELS[t.dimension] ?? t.dimension}: ${t.value} (${t.lift}x)`) } : null,
    accounts: { total: accounts.length, tiers },
    contacts: { total: contacts, verified },
    drafts: Object.fromEntries(drafts.map((d) => [d.verdict, Number(d.n)])),
    campaigns: { count: Number(camp?.n ?? 0), sent: Number(camp?.sent ?? 0), positive: Number(camp?.positive ?? 0), meetings: Number(camp?.meetings ?? 0) },
    pendingApprovals: listProposals(slug, "pending").length,
    spend: spentThisMonth(slug),
    files: listBrainFiles(slug).length,
  };
}
