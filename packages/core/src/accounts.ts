import { all, get, json, now, run } from "./db";
import { normalizeDomain } from "./traits";
import type { Account, Person, Signal } from "./types";

type AccountRow = {
  client: string;
  domain: string;
  name: string;
  industry: string | null;
  employees: number | null;
  region: string | null;
  country: string | null;
  tech: string | null;
  description: string | null;
  source: string | null;
  signals: string;
  score: number | null;
  fit: number | null;
  intent: number | null;
  tier: string | null;
  reasons: string;
  suppressed: string | null;
  scored_at: string | null;
};

export function toAccount(r: AccountRow): Account {
  return {
    client: r.client,
    domain: r.domain,
    name: r.name ?? r.domain,
    industry: r.industry ?? undefined,
    employees: r.employees ?? undefined,
    region: r.region ?? undefined,
    country: r.country ?? undefined,
    tech: json<string[]>(r.tech, []),
    description: r.description ?? undefined,
    source: r.source ?? undefined,
    signals: json<Signal[]>(r.signals, []),
    score: r.score ?? undefined,
    fit: r.fit ?? undefined,
    intent: r.intent ?? undefined,
    tier: r.tier ?? undefined,
    reasons: json<string[]>(r.reasons, []),
    suppressed: r.suppressed,
    scoredAt: r.scored_at ?? undefined,
  };
}

export function upsertAccount(
  slug: string,
  a: Partial<Omit<Account, "client">> & { domain: string; name?: string },
): Account {
  const domain = normalizeDomain(a.domain);
  const existing = getAccount(slug, domain);
  const merged = {
    name: a.name ?? existing?.name ?? domain,
    industry: a.industry ?? existing?.industry ?? null,
    employees: a.employees ?? existing?.employees ?? null,
    region: a.region ?? existing?.region ?? null,
    country: a.country ?? existing?.country ?? null,
    tech: JSON.stringify(a.tech && a.tech.length ? a.tech : (existing?.tech ?? [])),
    description: a.description ?? existing?.description ?? null,
    source: a.source ?? existing?.source ?? null,
    signals: JSON.stringify(a.signals ?? existing?.signals ?? []),
  };
  run(
    `INSERT INTO accounts (client, domain, name, industry, employees, region, country, tech, description, source, signals, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(client, domain) DO UPDATE SET name=excluded.name, industry=excluded.industry, employees=excluded.employees,
       region=excluded.region, country=excluded.country, tech=excluded.tech, description=excluded.description,
       source=excluded.source, signals=excluded.signals, updated_at=excluded.updated_at`,
    slug,
    domain,
    merged.name,
    merged.industry,
    merged.employees,
    merged.region,
    merged.country,
    merged.tech,
    merged.description,
    merged.source,
    merged.signals,
    now(),
  );
  return getAccount(slug, domain)!;
}

export function getAccount(slug: string, domain: string): Account | undefined {
  const r = get<AccountRow>("SELECT * FROM accounts WHERE client = ? AND domain = ?", slug, normalizeDomain(domain));
  return r ? toAccount(r) : undefined;
}

export function listAccounts(slug: string, opts: { tier?: string; limit?: number; includeSuppressed?: boolean } = {}): Account[] {
  const where = ["client = ?"];
  const params: unknown[] = [slug];
  if (opts.tier) {
    where.push("tier = ?");
    params.push(opts.tier);
  }
  if (!opts.includeSuppressed) where.push("(suppressed IS NULL OR suppressed = '')");
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  return all<AccountRow>(
    `SELECT * FROM accounts WHERE ${where.join(" AND ")} ORDER BY COALESCE(score, -1) DESC, name LIMIT ${limit}`,
    ...params,
  ).map(toAccount);
}

export function saveScore(
  slug: string,
  domain: string,
  s: { score: number; fit: number; intent: number; tier: string; reasons: string[]; suppressed: string | null },
) {
  run(
    "UPDATE accounts SET score=?, fit=?, intent=?, tier=?, reasons=?, suppressed=?, scored_at=? WHERE client=? AND domain=?",
    s.score,
    s.fit,
    s.intent,
    s.tier,
    JSON.stringify(s.reasons),
    s.suppressed,
    now(),
    slug,
    normalizeDomain(domain),
  );
}

export function saveContact(slug: string, p: Person & { waterfall?: unknown }) {
  run(
    `INSERT INTO contacts (client, id, domain, first_name, last_name, title, seniority, linkedin, email, email_status, waterfall, source, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(client, id) DO UPDATE SET title=excluded.title, seniority=excluded.seniority, linkedin=excluded.linkedin,
       email=COALESCE(excluded.email, contacts.email), email_status=COALESCE(excluded.email_status, contacts.email_status),
       waterfall=COALESCE(excluded.waterfall, contacts.waterfall), updated_at=excluded.updated_at`,
    slug,
    p.id,
    normalizeDomain(p.domain),
    p.firstName,
    p.lastName,
    p.title,
    p.seniority ?? null,
    p.linkedin ?? null,
    p.email ?? null,
    p.emailStatus ?? null,
    p.waterfall ? JSON.stringify(p.waterfall) : null,
    p.source,
    now(),
  );
}

export function listContacts(slug: string, domain?: string) {
  const rows = domain
    ? all<Record<string, unknown>>("SELECT * FROM contacts WHERE client = ? AND domain = ? ORDER BY updated_at DESC", slug, normalizeDomain(domain))
    : all<Record<string, unknown>>("SELECT * FROM contacts WHERE client = ? ORDER BY updated_at DESC LIMIT 500", slug);
  return rows.map((r) => ({
    id: r.id as string,
    domain: r.domain as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    title: r.title as string,
    seniority: r.seniority as string | null,
    linkedin: r.linkedin as string | null,
    email: r.email as string | null,
    emailStatus: r.email_status as string | null,
    waterfall: json<unknown[]>(r.waterfall, []),
    source: r.source as string,
  }));
}
