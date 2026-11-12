import { demoMode, env } from "../env";
import { get, json, now, run } from "../db";
import { GtmError, getClient, type Client } from "../brain/workspace";
import { getAccount, saveContact, upsertAccount } from "../accounts";
import { suppressionReason } from "../crm";
import { normalizeDomain } from "../traits";
import type { Company, EmailResult, Person, Signal, WaterfallStep } from "../types";
import { apolloProvider } from "./apollo";
import { hunterProvider, mapApolloStatus, zeroBounceProvider } from "./email";
import { mockProvider } from "./mock";
import { COLDIQ_USD_PER_CREDIT, coldiqProvider } from "./coldiq";
import { COSTS, type CompanyQuery, type DataProvider } from "./types";

const RELEVANT_ROLE = /sales|account exec|\bsdr\b|\bbdr\b|business development|revenue|rev ?ops|growth|marketing|demand|customer success|partnership/i;

export interface ProviderStatus {
  mode: "live" | "sample" | "off";
  reason: string;
  apollo: boolean;
  hunter: boolean;
  zerobounce: boolean;
  coldiq: boolean;
  anthropic: boolean;
}

export function providerStatus(client?: Client): ProviderStatus {
  const keys = {
    apollo: !!env("APOLLO_API_KEY"),
    hunter: !!env("HUNTER_API_KEY"),
    zerobounce: !!env("ZEROBOUNCE_API_KEY"),
    coldiq: !!env("COLDIQ_API_KEY"),
    anthropic: !!env("ANTHROPIC_API_KEY"),
  };
  if (client?.demo) return { mode: "sample", reason: "Demo client always uses sample data", ...keys };
  if (demoMode()) return { mode: "sample", reason: "GTM_DEMO_MODE=true", ...keys };
  // Real clients never fall back to made-up data: with no key, data tools stop with a clear message.
  if (keys.coldiq) return { mode: "live", reason: "Live data through ColdIQ", ...keys };
  if (!keys.apollo) return { mode: "off", reason: "Add COLDIQ_API_KEY (or APOLLO_API_KEY) to .env.local to search companies and people", ...keys };
  return { mode: "live", reason: "Live data through Apollo", ...keys };
}

/**
 * Merge new signals into stored ones. Funding: only the latest round is kept, so a stale enrichment
 * record ("2024 round") never sits beside or replaces a fresher one found by search ("2026 round").
 */
export function mergeSignals(existing: Signal[], found: Signal[]): { signals: Signal[]; added: number } {
  const keyOf = (s: Signal) => `${s.type}|${s.title.toLowerCase()}`;
  const map = new Map(existing.map((s) => [keyOf(s), s]));
  let added = 0;
  for (const s of found) {
    if (!map.has(keyOf(s))) added++;
    map.set(keyOf(s), s);
  }
  let all = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  const latestFunding = all.find((s) => s.type === "funding");
  if (latestFunding) all = all.filter((s) => s.type !== "funding" || s === latestFunding);
  return { signals: all, added: Math.min(added, all.length) };
}

export function spentThisMonth(slug: string): { credits: number; usd: number } {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const r = get<{ credits: number | null; usd: number | null }>(
    "SELECT SUM(credits) AS credits, SUM(usd) AS usd FROM ledger WHERE client = ? AND cached = 0 AND created_at >= ?",
    slug,
    start.toISOString(),
  );
  return { credits: Number(r?.credits ?? 0), usd: Number(r?.usd ?? 0) };
}

const TTL_DAYS: Record<string, number> = {
  searchCompanies: 7,
  enrichCompany: 30,
  findPeople: 14,
  matchPerson: 30,
  jobPostings: 3,
  findEmail: 30,
  verifyEmail: 30,
};

/** One per client: routes calls to live or sample providers, with cache, credit ledger and budget cap. */
export class DataGateway {
  readonly client: Client;
  readonly status: ProviderStatus;
  private data: DataProvider | null;
  private finder: DataProvider | null;
  private verifier: DataProvider | null;

  constructor(slug: string) {
    this.client = getClient(slug);
    this.status = providerStatus(this.client);
    if (this.status.mode === "sample") {
      const m = mockProvider();
      this.data = m;
      this.finder = m;
      this.verifier = m;
    } else if (this.status.mode === "off") {
      this.data = null;
      this.finder = null;
      this.verifier = null;
    } else if (env("COLDIQ_API_KEY")) {
      // One key, one bill: ColdIQ routes search, enrichment, email finding and verification to its best source.
      const ciq = coldiqProvider(env("COLDIQ_API_KEY")!, { hiringSignals: (env("COLDIQ_HIRING_SIGNALS") ?? "false").toLowerCase() === "true" });
      this.data = ciq;
      this.finder = ciq;
      this.verifier = env("ZEROBOUNCE_API_KEY") ? zeroBounceProvider(env("ZEROBOUNCE_API_KEY")!) : ciq;
    } else {
      this.data = apolloProvider(env("APOLLO_API_KEY")!);
      const hunter = env("HUNTER_API_KEY") ? hunterProvider(env("HUNTER_API_KEY")!) : null;
      const zb = env("ZEROBOUNCE_API_KEY") ? zeroBounceProvider(env("ZEROBOUNCE_API_KEY")!) : null;
      this.finder = hunter;
      this.verifier = zb ?? hunter;
    }
  }

  private async call<T>(p: DataProvider, method: string, args: unknown, fn: () => Promise<T>, meta?: string): Promise<{ value: T; cached: boolean; credits: number }> {
    const key = `${p.name}.${method}:${JSON.stringify(args)}`;
    const hit = get<{ value: string; expires_at: string }>("SELECT value, expires_at FROM cache WHERE key = ?", key);
    if (hit && hit.expires_at > now()) {
      this.ledger(p.name, method, 0, 0, true, meta);
      return { value: json<T>(hit.value, undefined as T), cached: true, credits: 0 };
    }
    const cost = p.live ? (COSTS[`${p.name}.${method}`] ?? { credits: 0, usd: 0 }) : { credits: 0, usd: 0 };
    if (cost.credits > 0) {
      const spent = spentThisMonth(this.client.slug).credits;
      if (spent + cost.credits > this.client.creditBudget) {
        throw new GtmError(
          `Monthly credit budget reached for ${this.client.name} (${spent}/${this.client.creditBudget}). Raise it with: gtm budget ${this.client.slug} <credits>`,
          "budget_exceeded",
        );
      }
    }
    p.takeCharge?.();
    const value = await fn();
    const actual = p.takeCharge?.();
    const charged = actual !== undefined ? { credits: Math.round(actual * 1000) / 1000, usd: Math.round(actual * COLDIQ_USD_PER_CREDIT * 10000) / 10000 } : cost;
    const expires = new Date(Date.now() + (TTL_DAYS[method] ?? 7) * 86_400_000).toISOString();
    run("INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?,?,?)", key, JSON.stringify(value ?? null), expires);
    this.ledger(p.name, method, charged.credits, charged.usd, false, meta);
    return { value, cached: false, credits: charged.credits };
  }

  private ledger(provider: string, action: string, credits: number, usd: number, cached: boolean, meta?: string) {
    run(
      "INSERT INTO ledger (client, provider, action, credits, usd, cached, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
      this.client.slug,
      provider,
      action,
      credits,
      usd,
      cached ? 1 : 0,
      meta ?? null,
      now(),
    );
  }

  private need(p: DataProvider | null, cap: keyof DataProvider, what: string): DataProvider {
    if (this.status.mode === "off") throw new GtmError(`${this.status.reason}.`, "no_provider");
    if (!p || typeof p[cap] !== "function") throw new GtmError(`No provider configured for ${what}. Add the API key to .env.local.`, "no_provider");
    return p;
  }

  async searchCompanies(q: CompanyQuery, save = true): Promise<(Company & { suppressed: string | null; signals: Signal[] })[]> {
    const p = this.need(this.data, "searchCompanies", "company search");
    const { value } = await this.call(p, "searchCompanies", q, () => p.searchCompanies!(q), JSON.stringify(q).slice(0, 200));
    // Search records can carry fresher facts (e.g. a funding round) than enrichment, so their signals are kept.
    const fresh = await Promise.all((value ?? []).map(async (c) => (p.companySignals ? await p.companySignals(c) : [])));
    return (value ?? []).map((c, i) => {
      const suppressed = suppressionReason(this.client.slug, c.domain);
      if (save) upsertAccount(this.client.slug, { ...c, signals: mergeSignals(getAccount(this.client.slug, c.domain)?.signals ?? [], fresh[i]).signals });
      return { ...c, suppressed, signals: fresh[i] };
    });
  }

  async enrichCompany(domain: string, save = true): Promise<Company | null> {
    const d = normalizeDomain(domain);
    const p = this.need(this.data, "enrichCompany", "company enrichment");
    const { value } = await this.call(p, "enrichCompany", d, () => p.enrichCompany!(d), d);
    if (value && save) upsertAccount(this.client.slug, { ...value, signals: getAccount(this.client.slug, d)?.signals });
    return value;
  }

  /** Funding, headcount, leadership, tool and hiring signals, merged into the stored account. */
  async findSignals(domain: string): Promise<{ company: Company | null; signals: Signal[]; added: number }> {
    const d = normalizeDomain(domain);
    const company = await this.enrichCompany(d);
    if (!company) return { company: null, signals: [], added: 0 };
    const p = this.data!;
    const found: Signal[] = [];
    if (p.companySignals) found.push(...(await p.companySignals(company)));
    if (p.jobPostings) {
      const { value } = await this.call(p, "jobPostings", company.providerId ?? d, () => p.jobPostings!(company), d);
      found.push(...(value ?? []).filter((s) => RELEVANT_ROLE.test(s.title)).slice(0, 8));
    }
    const { signals, added } = mergeSignals(getAccount(this.client.slug, d)?.signals ?? [], found);
    upsertAccount(this.client.slug, { domain: d, signals });
    return { company, signals, added };
  }

  async findPeople(domain: string, titles?: string[], limit = 5): Promise<(Person & { suppressed: string | null })[]> {
    const d = normalizeDomain(domain);
    const p = this.need(this.data, "findPeople", "people search");
    const q = { domain: d, titles, limit };
    const { value } = await this.call(p, "findPeople", q, () => p.findPeople!(q), d);
    return (value ?? []).map((person) => {
      saveContact(this.client.slug, person);
      return { ...person, suppressed: suppressionReason(this.client.slug, d) };
    });
  }

  /**
   * Email waterfall: Apollo match (stop if verified) -> finder -> verifier.
   * Every step, its outcome and credits are returned so the UI can show the trace.
   */
  async findEmail(person: { id?: string; firstName: string; lastName: string; domain: string; title?: string }): Promise<EmailResult & { suppressed: string | null }> {
    const d = normalizeDomain(person.domain);
    const steps: WaterfallStep[] = [];
    const accountBlock = suppressionReason(this.client.slug, d);
    if (accountBlock) return { email: null, status: "not_found", steps: [{ provider: "crm", action: "suppression", outcome: accountBlock, credits: 0, cached: false }], suppressed: accountBlock };

    let candidate: string | null = null;
    let status: EmailResult["status"] = "not_found";
    const finish = (r: EmailResult) => {
      const suppressed = r.email ? suppressionReason(this.client.slug, d, r.email) : null;
      if (person.id) {
        saveContact(this.client.slug, {
          id: person.id,
          firstName: person.firstName,
          lastName: person.lastName,
          title: person.title ?? "",
          domain: d,
          email: r.email ?? undefined,
          emailStatus: r.status,
          source: this.status.mode === "live" ? "waterfall" : "sample",
          waterfall: r.steps,
        });
      }
      return { ...r, suppressed };
    };

    if (this.data?.matchPerson) {
      const args = { id: person.id, firstName: person.firstName, lastName: person.lastName, domain: d };
      const { value: m, cached, credits } = await this.call(this.data, "matchPerson", args, () => this.data!.matchPerson!(args), `${person.firstName} ${person.lastName} @ ${d}`);
      const s = mapApolloStatus(m?.emailStatus);
      steps.push({ provider: this.data.name, action: "match person", outcome: m?.email ? `${m.email} (${m.emailStatus ?? "no status"})` : "no email", credits, cached });
      if (m?.email && s === "verified") return finish({ email: m.email, status: "verified", steps });
      if (m?.email && s !== "invalid") candidate = m.email;
    }

    const verify = async (email: string) => {
      if (!this.verifier?.verifyEmail) return null;
      const { value: v, cached, credits } = await this.call(this.verifier, "verifyEmail", email, () => this.verifier!.verifyEmail!(email), email);
      steps.push({ provider: this.verifier.name, action: "verify", outcome: `${email}: ${v.raw}`, credits, cached });
      return v.status;
    };

    if (candidate) {
      const s = await verify(candidate);
      if (s === "verified" || s === "catch_all" || s === "risky") return finish({ email: candidate, status: s, steps });
      if (s === null) return finish({ email: candidate, status: "unverified", steps });
      status = "invalid";
    }

    if (this.finder?.findEmail) {
      // A LinkedIn URL beats a name: provider names can carry suffixes ("Amanda Mba") or nicknames.
      const linkedin = person.id?.startsWith("coldiq:") && !person.id.includes(".") ? `https://www.linkedin.com/in/${person.id.slice(7)}` : undefined;
      const args = { firstName: person.firstName, lastName: person.lastName, domain: d, ...(linkedin ? { linkedin } : {}) };
      const { value: f, cached, credits } = await this.call(this.finder, "findEmail", args, () => this.finder!.findEmail!(args), `${person.firstName} ${person.lastName} @ ${d}`);
      steps.push({ provider: this.finder.name, action: "find email", outcome: f.email ? `${f.email}${f.score ? ` (score ${f.score})` : ""}${f.status ? ` (${f.status})` : ""}` : "no email", credits, cached });
      // The finder already verified it (ColdIQ verifies on hit), so a second paid check adds nothing.
      if (f.email && f.status === "verified") return finish({ email: f.email, status: "verified", steps });
      if (f.email && f.status === "invalid") status = "invalid";
      else if (f.email && f.email !== candidate) {
        const s = await verify(f.email);
        if (s === "verified" || s === "catch_all" || s === "risky") return finish({ email: f.email, status: s, steps });
        if (s === null) return finish({ email: f.email, status: "unverified", steps });
        status = "invalid";
      }
    }
    return finish({ email: null, status, steps });
  }
}
