import type { Company, EmailStatus, Person, Signal } from "../types";
import { normalizeDomain, seniorityOf } from "../traits";
import { regionOf } from "./apollo";
import { ProviderError, httpJson, type CompanyQuery, type DataProvider, type PersonQuery } from "./types";

/**
 * ColdIQ API (https://api.coldiq.com): one key that routes each call to the best of 40+ data providers
 * (ColdIQ's own data, AI Ark, BounceBan, TheirStack, Fundable, ...). Response shapes below were checked
 * against live calls. Every response carries `_meta.credits_charged`, which is what the ledger records.
 */
const BASE = "https://api.coldiq.com/v1";
/** Retail price of one ColdIQ credit from /v1/me/credits (Nov 2026). Only used to show dollars on the Spend page. */
export const COLDIQ_USD_PER_CREDIT = 1 / 70;

type Meta = { credits_charged?: number; provider?: string; provider_name?: string };
type Envelope<T> = { data?: T | null; _meta?: Meta | null; found?: boolean; verdict?: string; reason?: string };

type CiqCompany = {
  name?: string;
  domain?: string;
  website?: string;
  linkedin_url?: string;
  employees?: number;
  industry?: string;
  country?: string;
  city?: string;
  description?: string;
  company_data?: {
    company_id?: string;
    company_funding?: { last_round_type?: string | null; last_round_date?: string | null; total_raised_usd?: number };
  };
  company_detected_technologies?: { technology_product?: { name?: string } }[];
};

type CiqPerson = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  seniority?: string;
  linkedin_url?: string;
  company_domain?: string;
};

type CiqJob = { job_title?: string; url?: string; source_url?: string; date_posted?: string; discovered_at?: string; country?: string; remote?: boolean };

const COUNTRY_CODES: Record<string, string> = {
  "united states": "US", usa: "US", canada: "CA", "united kingdom": "GB", uk: "GB", ireland: "IE", germany: "DE", france: "FR",
  netherlands: "NL", spain: "ES", italy: "IT", sweden: "SE", denmark: "DK", norway: "NO", finland: "FI", belgium: "BE",
  switzerland: "CH", austria: "AT", portugal: "PT", poland: "PL", australia: "AU", "new zealand": "NZ", india: "IN",
  singapore: "SG", japan: "JP", brazil: "BR", mexico: "MX", israel: "IL", "united arab emirates": "AE",
};
const REGION_COUNTRIES: Record<string, string[]> = {
  "north america": ["US", "CA"],
  "uk & ireland": ["GB", "IE"],
  europe: ["DE", "FR", "NL", "ES", "IT", "SE", "DK", "NO", "FI", "BE", "CH", "AT", "PT", "PL"],
  anz: ["AU", "NZ"],
  apac: ["IN", "SG", "JP", "AU"],
  latam: ["BR", "MX", "AR", "CL", "CO"],
  mea: ["IL", "AE", "SA", "ZA"],
};

/** "United States", "Europe", "US" -> ISO-2 codes ColdIQ's own data can match without a paid fallback. */
export function toCountryCodes(locations: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of locations) {
    const l = raw.trim().toLowerCase();
    if (REGION_COUNTRIES[l]) REGION_COUNTRIES[l].forEach((c) => out.add(c));
    else if (COUNTRY_CODES[l]) out.add(COUNTRY_CODES[l]);
    else if (/^[a-z]{2}$/.test(l)) out.add(l.toUpperCase());
  }
  return [...out];
}

/** Apollo-style ranges ("51,200") -> one min/max span. */
export function employeeSpan(ranges: string[] = []): { min_employees?: number; max_employees?: number } {
  const nums = ranges.map((r) => r.split(",").map((n) => Number(n.trim()))).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (!nums.length) return {};
  return { min_employees: Math.min(...nums.map(([a]) => a)), max_employees: Math.max(...nums.map(([, b]) => b)) };
}

const COUNTRY_NAMES = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
/** ColdIQ gives ISO-2 codes ("US"); the ICP and region logic use names ("United States"). */
export function countryName(code?: string | null): string | undefined {
  if (!code) return undefined;
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  const upper = code.toUpperCase();
  try {
    return COUNTRY_NAMES?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/**
 * Clean provider names for use in an email: "Horizon3.Ai" -> "Horizon3.ai", "Hyperverge" stays,
 * all-caps or all-lowercase names are title-cased, legal suffixes are dropped.
 */
export function displayName(name: string | undefined, domain: string): string {
  let n = (name ?? "").trim();
  if (!n) return domain;
  if (n === n.toLowerCase() || (n === n.toUpperCase() && n.length > 4)) n = n.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase());
  n = n.replace(/\.(Ai|Io|Co|App|Com|Dev|So)\b/g, (x) => x.toLowerCase());
  n = n.replace(/,?\s+(Inc\.?|LLC|Llc|Ltd\.?|Limited|GmbH|Corp\.?|Corporation)$/i, "");
  return n;
}

export function toCompany(c: CiqCompany): Company | null {
  const domain = normalizeDomain(c.domain || c.website);
  if (!domain) return null;
  const funding = c.company_data?.company_funding;
  return {
    name: displayName(c.name, domain),
    domain,
    industry: c.industry ?? undefined,
    employees: typeof c.employees === "number" && c.employees > 0 ? c.employees : undefined,
    country: countryName(c.country),
    region: regionOf(countryName(c.country)),
    tech: (c.company_detected_technologies ?? []).map((t) => t.technology_product?.name ?? "").filter(Boolean).slice(0, 40),
    description: c.description?.slice(0, 600),
    linkedin: c.linkedin_url,
    providerId: c.company_data?.company_id,
    fundingStage: funding?.last_round_type ?? undefined,
    lastFundingDate: funding?.last_round_date ?? undefined,
    source: "coldiq",
  };
}

/** Verbose company record when ColdIQ routes a search to AI Ark (checked against live responses, Nov 2026). */
export type ArkCompany = {
  id?: string;
  summary?: { name?: string; overview?: string; description?: string; industry?: string; staff?: { total?: number } };
  link?: { website?: string; domain?: string; linkedin?: string };
  location?: { headquarter?: { country?: string; city?: string } };
  technologies?: { name?: string; category?: string }[];
  industries?: string[];
  financial?: { funding?: { type?: string; last_amount?: number; date?: string; rounds?: { announced_at?: string; raised_amount?: number; type?: string }[] } };
};

const titleCase = (s: string) => s.replace(/\b\w/g, (x) => x.toUpperCase());
/** "tyson hempel" -> "Tyson Hempel"; names that already have capitals ("McDonald", "de Vries") are left alone. */
export const properCase = (s: string) => (s && s === s.toLowerCase() ? titleCase(s) : s);
/** Only the categories that say something about how a company sells or runs, not CDNs and fonts. */
const USEFUL_TECH = /crm|marketing|sales|analytics|email|chat|support|payment|commerce|automation|crm|hr|recruit|communication|productivity|collaboration|data|cloud|security/i;

export function arkToCompany(c: ArkCompany): Company | null {
  const domain = normalizeDomain(c.link?.domain || c.link?.website);
  if (!domain) return null;
  const f = c.financial?.funding;
  // Primary rounds only: a secondary sale is not new money for the company.
  const rounds = (f?.rounds ?? []).filter((r) => r.announced_at && !/secondary/i.test(r.type ?? "")).sort((a, b) => b.announced_at!.localeCompare(a.announced_at!));
  const last = rounds[0];
  const country = countryName(c.location?.headquarter?.country);
  const tech = (c.technologies ?? []).filter((t) => t.name && (!t.category || USEFUL_TECH.test(t.category))).map((t) => titleCase(t.name!));
  return {
    name: displayName(c.summary?.name, domain),
    domain,
    industry: c.summary?.industry ? titleCase(c.summary.industry) : undefined,
    employees: c.summary?.staff?.total || undefined,
    country,
    region: regionOf(country),
    tech: [...new Set(tech)].slice(0, 40),
    description: (c.summary?.overview ?? c.summary?.description)?.slice(0, 600),
    linkedin: c.link?.linkedin,
    providerId: c.id,
    fundingStage: last?.type ?? f?.type,
    lastFundingDate: last?.announced_at ?? f?.date,
    lastFundingAmount: last?.raised_amount ?? f?.last_amount,
    source: "coldiq",
  };
}

/** ("SERIES_F", 150e6) -> "Raised a $150M Series F". Generic or unknown round types read naturally. */
export function fundingTitle(stage?: string, amount?: number): string {
  const s = (stage ?? "").replace(/_/g, " ").toLowerCase().trim();
  const named = /^(pre[- ]?seed|seed|series [a-z])$/.test(s) ? s.replace(/\b\w/g, (x) => x.toUpperCase()).replace(/^Pre[- ]Seed$/, "Pre-Seed") : "";
  const amt = money(amount);
  if (named) return amt ? `Raised a ${amt} ${named}` : `Raised a ${named} round`;
  return amt ? `Raised ${amt}` : "Raised a funding round";
}

/** "$150M", "$8.5M", "$900K" */
export function money(n?: number): string {
  if (!n) return "";
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/** ColdIQ email statuses (finder `email_status`/`verification`, verifier `status`/`result`) -> ours. */
export function mapColdiqStatus(status?: string | null, verification?: string | null): EmailStatus {
  const s = `${status ?? ""}`.toLowerCase();
  const v = `${verification ?? ""}`.toLowerCase();
  if (s === "valid" || s === "deliverable" || v === "verified") return "verified";
  if (s.includes("catch") || s === "accept_all") return "catch_all";
  if (s === "invalid" || s === "undeliverable" || s === "disposable" || v === "rejected") return "invalid";
  if (s === "risky" || s === "unknown") return "risky";
  return "unverified";
}

export function coldiqProvider(apiKey: string, opts: { hiringSignals?: boolean } = {}): DataProvider & { takeCharge(): number | undefined } {
  let lastCharge: number | undefined;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    // ColdIQ's edge blocks some default client User-Agents with a bare 403.
    "User-Agent": "gtm-brain/1.0",
  };
  async function post<T>(path: string, body: unknown, timeoutMs = 60000): Promise<Envelope<T>> {
    const res = (await httpJson("coldiq", `${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs)) as Envelope<T>;
    lastCharge = (lastCharge ?? 0) + Number(res?._meta?.credits_charged ?? 0);
    return res;
  }
  const found = <T>(r: Envelope<T>) => r.found !== false && r.data != null;

  return {
    name: "coldiq",
    live: true,
    /** Credits ColdIQ actually charged since the last call to takeCharge (summed over sub-calls). */
    takeCharge() {
      const c = lastCharge;
      lastCharge = undefined;
      return c;
    },
    async searchCompanies(q: CompanyQuery) {
      const countries = toCountryCodes(q.locations);
      const input = {
        // CRM industry labels ("B2B SaaS") rarely match a data vendor's taxonomy, so they go in as keywords,
        // which match how companies describe themselves.
        keywords: [...(q.keywords ?? []), ...(q.industries ?? [])].filter(Boolean).slice(0, 8),
        ...(countries.length ? { countries } : {}),
        ...employeeSpan(q.employeeRanges),
        ...(q.technologies?.length ? { technologies: q.technologies } : {}),
        ...(q.fundedSinceYear ? { min_funding_year: q.fundedSinceYear } : {}),
        ...(q.excludeKeywords?.length ? { exclude_keywords: q.excludeKeywords.slice(0, 20) } : {}),
        ...(q.excludeIndustries?.length ? { exclude_industries: q.excludeIndustries.slice(0, 20) } : {}),
        limit: Math.min(q.limit ?? 25, 100),
        page: Math.max(0, (q.page ?? 1) - 1),
      };
      // The compact record drops funding rounds, technologies and headquarters. The verbose record has them at the same price.
      const r = await post<{ companies?: CiqCompany[]; content?: ArkCompany[] }>("/companies/search", { input, soft_miss: true, fields: "verbose" });
      if (!found(r)) return [];
      const rows = [...(r.data?.companies ?? []).map(toCompany), ...(r.data?.content ?? []).map(arkToCompany)];
      return rows.filter((c): c is Company => !!c);
    },
    async enrichCompany(domain: string) {
      const r = await post<{ found?: boolean; company?: CiqCompany }>("/company/enrich", { input: { domain: normalizeDomain(domain) }, soft_miss: true });
      if (!found(r) || r.data?.found === false || !r.data?.company) return null;
      return toCompany({ ...r.data.company, domain: r.data.company.domain ?? normalizeDomain(domain) });
    },
    async findPeople(q: PersonQuery) {
      const d = normalizeDomain(q.domain);
      const input = {
        company_domains: [d],
        ...(q.titles?.length ? { job_titles: q.titles } : {}),
        ...(q.seniorities?.length ? { seniorities: q.seniorities } : {}),
        limit: Math.min(q.limit ?? 5, 50),
      };
      const r = await post<{ people?: CiqPerson[] }>("/people/search", { input, soft_miss: true });
      if (!found(r)) return [];
      return (r.data?.people ?? []).map((p, i): Person => {
        const [first, ...rest] = (p.full_name ?? "").split(" ");
        return {
          id: `coldiq:${p.linkedin_url ? p.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "") : `${d}:${i}`}`,
          firstName: properCase(p.first_name ?? first ?? ""),
          lastName: properCase(p.last_name ?? rest.join(" ")),
          title: p.title && p.title === p.title.toLowerCase() ? titleCase(p.title).replace(/\bVp\b/g, "VP").replace(/\b(Ceo|Cro|Coo|Cfo|Cto)\b/g, (x) => x.toUpperCase()) : (p.title ?? ""),
          domain: d,
          seniority: seniorityOf(p.title ?? ""),
          linkedin: p.linkedin_url,
          source: "coldiq",
        };
      });
    },
    async findEmail(p) {
      const r = await post<{ email?: string | null; work_email?: string | null; email_status?: string; verification?: string }>(
        "/email/find",
        {
          input: { first_name: p.firstName, last_name: p.lastName, domain: normalizeDomain(p.domain), ...(p.linkedin ? { linkedin_url: p.linkedin } : {}) },
          soft_miss: true,
          // With a LinkedIn URL, a person who changed jobs is looked up at their current employer.
          ...(p.linkedin ? { resolve_current_employer: true } : {}),
        },
        90000,
      );
      if (!found(r)) return { email: null };
      const email = r.data?.work_email ?? r.data?.email ?? null;
      return { email, status: email ? mapColdiqStatus(r.data?.email_status, r.data?.verification) : undefined };
    },
    async verifyEmail(email: string) {
      const r = await post<{ status?: string; result?: string }>("/email/verify", { input: { email }, soft_miss: true }, 90000);
      if (!found(r)) return { status: "risky", raw: r.verdict ?? "unknown" };
      const raw = r.data?.status ?? r.data?.result ?? "unknown";
      return { status: mapColdiqStatus(raw), raw };
    },
    /** Funding comes free with the company record. Hiring costs about 7.5 credits a company, so it is opt-in. */
    async companySignals(c: Company) {
      const out: Signal[] = [];
      if (c.lastFundingDate && !Number.isNaN(Date.parse(c.lastFundingDate))) {
        out.push({ type: "funding", title: fundingTitle(c.fundingStage, c.lastFundingAmount), date: new Date(c.lastFundingDate).toISOString(), source: "coldiq" });
      }
      return out;
    },
    ...(opts.hiringSignals
      ? {
          async jobPostings(c: Company) {
            // Billed per job returned (about 2.5 credits each), so ask only for recent, open, direct-hire roles.
            const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
            const r = await post<{ data?: CiqJob[] }>(
              "/signals/find",
              { input: { signal_type: "hiring", domains: [c.domain], since, still_open: true, exclude_recruiting_agencies: true, limit: 5 }, soft_miss: true },
              90000,
            );
            if (!found(r)) return [];
            return (r.data?.data ?? []).map(
              (j): Signal => ({
                type: "hiring",
                title: `Hiring: ${j.job_title ?? "open role"}`,
                detail: j.remote ? "Remote" : j.country ? `Location: ${j.country}` : undefined,
                url: j.url ?? j.source_url,
                date: new Date(j.date_posted ?? j.discovered_at ?? Date.now()).toISOString(),
                source: "coldiq",
              }),
            );
          },
        }
      : {}),
  };
}

/** Free call: the account's live ColdIQ credit balance. */
export async function coldiqCredits(apiKey: string): Promise<{ balance: number; usedThisMonth: number; usdPerCredit: number }> {
  const r = (await httpJson("coldiq", `${BASE}/me/credits`, { headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "gtm-brain/1.0" } })) as {
    balance?: number;
    usedThisMonth?: number;
    usd_per_credit?: number;
  };
  if (typeof r.balance !== "number") throw new ProviderError("coldiq", "unexpected credits response");
  return { balance: r.balance, usedThisMonth: r.usedThisMonth ?? 0, usdPerCredit: r.usd_per_credit ?? COLDIQ_USD_PER_CREDIT };
}
