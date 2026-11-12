import type { Company, Person, Signal } from "../types";
import { normalizeDomain, seniorityOf } from "../traits";
import { regionOf } from "./apollo";
import type { CompanyQuery, DataProvider, PersonQuery } from "./types";

/**
 * Sample-data provider. Deterministic: the same domain always returns the same company,
 * people, signals and email results, so demos and tests are repeatable. No network calls.
 * All companies and people are fictional.
 */

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const pick = <T>(arr: readonly T[], seed: string): T => arr[fnv(seed) % arr.length];
const unit = (seed: string) => (fnv(seed) % 10000) / 10000;

export const MOCK_INDUSTRIES = [
  "B2B SaaS",
  "Fintech",
  "Cybersecurity",
  "HR Tech",
  "Martech",
  "DevTools",
  "Logistics Software",
  "Healthcare IT",
  "E-commerce Platform",
  "Legal Tech",
] as const;
export const MOCK_TECH = ["HubSpot", "Salesforce", "Outreach", "Salesloft", "Gong", "Segment", "Snowflake", "Intercom", "Marketo", "Pipedrive", "Clay", "Apollo"] as const;
const COUNTRIES = ["United States", "United States", "United States", "Canada", "United Kingdom", "Germany", "Netherlands", "France", "Australia", "India"] as const;
const PREFIX = ["Lumen", "Corvid", "Tidal", "Quarry", "Halcyon", "Vantage", "Meridian", "Pinecrest", "Ardent", "Kestrel", "Saltbox", "Ironleaf", "Bluefin", "Cobalt", "Foxglove", "Harborline", "Juniper", "Larkspur", "Mosaic", "Nimbus", "Orchard", "Parallax", "Redwood", "Sable", "Thistle", "Umbra", "Verge", "Willowby", "Yarrow", "Zephyr"] as const;
const SUFFIX = ["Labs", "Analytics", "Systems", "Cloud", "Works", "Data", "Logic", "Stack", "Metrics", "Ops"] as const;
const TLD = [".io", ".com", ".ai", ".co"] as const;
const FIRST = ["Maya", "Jonah", "Priya", "Theo", "Lena", "Marcus", "Ava", "Diego", "Sofia", "Ethan", "Nora", "Kai", "Isla", "Omar", "Hana", "Lucas", "Zara", "Felix", "Ines", "Ravi"] as const;
const LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Castillo", "Brennan", "Haddad", "Novak", "Sato", "Whitlock", "Duarte", "Kowalski", "Achebe", "Fischer", "Nakamura", "Rossi", "Iverson", "Mensah", "Larsen", "Quinn"] as const;
const TITLES = ["VP of Sales", "Head of Sales", "Director of Revenue Operations", "Head of Growth", "VP Marketing", "Chief Revenue Officer", "Sales Operations Manager", "Head of Demand Generation", "Founder & CEO", "Account Executive", "SDR Manager", "VP of Revenue"] as const;
const ROLES = ["Account Executive", "SDR", "Revenue Operations Manager", "Head of Growth", "Demand Generation Manager", "VP of Sales"] as const;

function sizeFor(seed: string): number {
  const r = unit(seed + ":size");
  if (r < 0.1) return 8 + Math.floor(unit(seed + "e") * 40);
  if (r < 0.62) return 55 + Math.floor(unit(seed + "e") * 140);
  if (r < 0.85) return 210 + Math.floor(unit(seed + "e") * 280);
  return 520 + Math.floor(unit(seed + "e") * 3000);
}

export function mockCompany(domainOrSeed: string, nameHint?: string): Company {
  const domain = normalizeDomain(domainOrSeed);
  const seed = domain;
  const name = nameHint ?? titleFromDomain(domain);
  const country = pick(COUNTRIES, seed + ":c");
  const tech = MOCK_TECH.filter((t) => unit(`${seed}:t:${t}`) < 0.28);
  const industry = pick(MOCK_INDUSTRIES, seed + ":i");
  const employees = sizeFor(seed);
  const fundingDays = Math.floor(unit(seed + ":fd") * 400);
  return {
    name,
    domain,
    industry,
    employees,
    country,
    region: regionOf(country),
    tech,
    description: `${name} builds ${industry.toLowerCase()} software for ${pick(["mid-market", "enterprise", "SMB", "high-growth"], seed + ":seg")} teams.`,
    providerId: `mock-${fnv(seed).toString(36)}`,
    fundingStage: unit(seed + ":f") < 0.45 ? pick(["Seed", "Series A", "Series B", "Series C"], seed + ":fs") : undefined,
    lastFundingDate: unit(seed + ":f") < 0.45 ? new Date(Date.now() - fundingDays * 86_400_000).toISOString() : undefined,
    headcountGrowth6m: Math.round((unit(seed + ":g") * 0.5 - 0.08) * 100) / 100,
    source: "sample",
  };
}

function titleFromDomain(domain: string): string {
  const base = domain.split(".")[0];
  for (const p of PREFIX) {
    if (base.startsWith(p.toLowerCase())) {
      const rest = base.slice(p.length);
      const suf = SUFFIX.find((s) => s.toLowerCase() === rest);
      return suf ? `${p} ${suf}` : p;
    }
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** The fixed sample universe (300 fictional companies). */
export function mockUniverse(): Company[] {
  const out: Company[] = [];
  for (const p of PREFIX)
    for (const s of SUFFIX) {
      const domain = `${p}${s}`.toLowerCase() + pick(TLD, p + s);
      out.push(mockCompany(domain, `${p} ${s}`));
    }
  return out;
}

export function mockSignals(c: Company): Signal[] {
  const seed = c.domain;
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const out: Signal[] = [];
  if (c.lastFundingDate && c.fundingStage) out.push({ type: "funding", title: `Raised ${c.fundingStage}`, date: c.lastFundingDate, source: "sample" });
  const roles = ROLES.filter((r) => unit(`${seed}:h:${r}`) < 0.22);
  roles.forEach((r, i) =>
    out.push({
      type: "hiring",
      title: `Hiring: ${r}`,
      url: `https://${c.domain}/careers/${r.toLowerCase().replace(/\s+/g, "-")}`,
      date: day(Math.floor(unit(`${seed}:hd:${i}`) * 50)),
      source: "sample",
    }),
  );
  if (unit(seed + ":lc") < 0.2)
    out.push({ type: "leadership_change", title: `New ${pick(["VP of Sales", "CRO", "Head of Growth", "VP Marketing"], seed + ":lct")} joined`, date: day(Math.floor(unit(seed + ":lcd") * 80)), source: "sample" });
  if (unit(seed + ":ta") < 0.2)
    out.push({ type: "tech_adoption", title: `Started using ${pick(MOCK_TECH, seed + ":tat")}`, date: day(Math.floor(unit(seed + ":tad") * 120)), source: "sample" });
  if ((c.headcountGrowth6m ?? 0) >= 0.1)
    out.push({ type: "headcount_growth", title: `Headcount up ${Math.round((c.headcountGrowth6m ?? 0) * 100)}% in 6 months`, date: day(30), source: "sample" });
  if (unit(seed + ":wi") < 0.15)
    out.push({ type: "web_intent", title: "Visited your pricing page twice this week", date: day(Math.floor(unit(seed + ":wid") * 10)), source: "sample" });
  return out;
}

export function mockPeople(domain: string, limit = 6): Person[] {
  const d = normalizeDomain(domain);
  const n = 3 + (fnv(d + ":n") % 4);
  const out: Person[] = [];
  for (let i = 0; i < Math.min(n, limit); i++) {
    const firstName = pick(FIRST, `${d}:f:${i}`);
    const lastName = pick(LAST, `${d}:l:${i}`);
    const title = TITLES[(fnv(`${d}:t`) + i * 5) % TITLES.length];
    out.push({ id: `sample:${d}:${i}`, firstName, lastName, title, domain: d, seniority: seniorityOf(title), linkedin: `https://www.linkedin.com/in/${firstName}-${lastName}-${fnv(d + i) % 9999}`.toLowerCase(), source: "sample" });
  }
  return out;
}

export function mockProvider(): DataProvider {
  const universe = mockUniverse();
  return {
    name: "sample",
    live: false,
    async searchCompanies(q: CompanyQuery) {
      const kws = [...(q.keywords ?? []), ...(q.industries ?? [])].map((k) => k.toLowerCase());
      const ranges = (q.employeeRanges ?? []).map((r) => r.split(",").map(Number));
      const locs = (q.locations ?? []).map((l) => l.toLowerCase());
      const techs = (q.technologies ?? []).map((t) => t.toLowerCase());
      const res = universe.filter((c) => {
        const text = `${c.industry} ${c.description}`.toLowerCase();
        if (kws.length && !kws.some((k) => text.includes(k))) return false;
        if (ranges.length && !ranges.some(([min, max]) => (c.employees ?? 0) >= min && (c.employees ?? 0) <= (max || Infinity))) return false;
        if (locs.length && !locs.some((l) => `${c.country} ${c.region}`.toLowerCase().includes(l))) return false;
        if (techs.length && !techs.some((t) => (c.tech ?? []).some((x) => x.toLowerCase() === t))) return false;
        return true;
      });
      const start = ((q.page ?? 1) - 1) * (q.limit ?? 25);
      return res.slice(start, start + (q.limit ?? 25));
    },
    async enrichCompany(domain) {
      const d = normalizeDomain(domain);
      return universe.find((c) => c.domain === d) ?? mockCompany(d);
    },
    async findPeople(q: PersonQuery) {
      let people = mockPeople(q.domain, 6);
      if (q.titles?.length) {
        const t = q.titles.map((x) => x.toLowerCase());
        const filtered = people.filter((p) => t.some((x) => p.title.toLowerCase().includes(x) || x.split(" ").some((w) => w.length > 3 && p.title.toLowerCase().includes(w))));
        if (filtered.length) people = filtered;
      }
      return people.slice(0, q.limit ?? 10);
    },
    async matchPerson(p) {
      const first = (p.firstName ?? "").toLowerCase();
      const last = (p.lastName ?? "").toLowerCase();
      const r = unit(`${p.domain}:${first}:${last}:m`);
      if (r < 0.45) return { email: `${first}.${last}@${normalizeDomain(p.domain)}`, emailStatus: "verified" };
      if (r < 0.7) return { email: `${first}@${normalizeDomain(p.domain)}`, emailStatus: "guessed" };
      return { emailStatus: "unavailable" };
    },
    async jobPostings(c) {
      return mockSignals(c).filter((s) => s.type === "hiring");
    },
    async companySignals(c) {
      return mockSignals(c).filter((s) => s.type !== "hiring");
    },
    async findEmail(p) {
      const r = unit(`${p.domain}:${p.firstName}:${p.lastName}:h`);
      if (r < 0.8) return { email: `${p.firstName}.${p.lastName}@${normalizeDomain(p.domain)}`.toLowerCase(), score: Math.round(60 + r * 40) };
      return { email: null };
    },
    async verifyEmail(email) {
      const r = unit(email + ":v");
      if (r < 0.7) return { status: "verified", raw: "valid" };
      if (r < 0.85) return { status: "catch_all", raw: "catch-all" };
      if (r < 0.93) return { status: "risky", raw: "unknown" };
      return { status: "invalid", raw: "invalid" };
    },
  };
}
