import type { Company, Person, Signal } from "../types";
import { normalizeDomain, seniorityOf } from "../traits";
import { httpJson, type CompanyQuery, type DataProvider, type MatchedPerson, type PersonQuery } from "./types";

const BASE = "https://api.apollo.io/api/v1";

type Q = Record<string, string | number | boolean | string[] | undefined>;
function qs(params: Q): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    if (Array.isArray(v)) v.filter(Boolean).forEach((x) => sp.append(`${k}[]`, x));
    else sp.append(k, String(v));
  }
  return sp.toString();
}

type ApolloOrg = {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  country?: string;
  city?: string;
  state?: string;
  technology_names?: string[];
  current_technologies?: { name?: string }[];
  latest_funding_stage?: string;
  latest_funding_round_date?: string;
  total_funding?: number;
  short_description?: string;
  organization_headcount_six_month_growth?: number;
  linkedin_url?: string;
};

function toCompany(o: ApolloOrg): Company | null {
  const domain = normalizeDomain(o.primary_domain || o.website_url);
  if (!domain) return null;
  const tech = o.technology_names?.length ? o.technology_names : (o.current_technologies ?? []).map((t) => t.name ?? "").filter(Boolean);
  return {
    name: o.name ?? domain,
    domain,
    industry: o.industry ? titleCase(o.industry) : undefined,
    employees: o.estimated_num_employees,
    country: o.country,
    region: regionOf(o.country),
    tech: tech.slice(0, 40),
    description: o.short_description,
    linkedin: o.linkedin_url,
    providerId: o.id,
    fundingStage: o.latest_funding_stage,
    lastFundingDate: o.latest_funding_round_date,
    headcountGrowth6m: o.organization_headcount_six_month_growth,
    source: "apollo",
  };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const EU = /germany|france|spain|italy|netherlands|belgium|sweden|denmark|norway|finland|ireland|portugal|austria|switzerland|poland|czech|estonia|latvia|lithuania|greece|romania|hungary/i;
export function regionOf(country?: string): string | undefined {
  if (!country) return undefined;
  if (/united states|usa|canada/i.test(country)) return "North America";
  if (/united kingdom|uk|england|scotland/i.test(country)) return "UK & Ireland";
  if (EU.test(country)) return "Europe";
  if (/australia|new zealand/i.test(country)) return "ANZ";
  if (/india|singapore|japan|china|korea|indonesia|philippines|vietnam|malaysia|thailand/i.test(country)) return "APAC";
  if (/brazil|mexico|argentina|chile|colombia|peru/i.test(country)) return "LATAM";
  if (/israel|emirates|uae|saudi|qatar|egypt|south africa|nigeria|kenya/i.test(country)) return "MEA";
  return country;
}

export function apolloProvider(apiKey: string): DataProvider {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": apiKey };
  return {
    name: "apollo",
    live: true,
    async searchCompanies(q: CompanyQuery) {
      const params = qs({
        "q_organization_keyword_tags": [...(q.keywords ?? []), ...(q.industries ?? [])],
        "organization_num_employees_ranges": q.employeeRanges,
        "organization_locations": q.locations,
        "latest_funding_date_range[min]": q.fundedSinceYear ? `${q.fundedSinceYear}-01-01` : undefined,
        "currently_using_any_of_technology_uids": q.technologies?.map((t) => t.toLowerCase().replace(/[\s.]+/g, "_")),
        page: q.page ?? 1,
        per_page: Math.min(q.limit ?? 25, 100),
      });
      const res = (await httpJson("apollo", `${BASE}/mixed_companies/search?${params}`, { method: "POST", headers })) as {
        organizations?: ApolloOrg[];
        accounts?: ApolloOrg[];
      };
      return [...(res.organizations ?? []), ...(res.accounts ?? [])].map(toCompany).filter((c): c is Company => !!c);
    },
    async enrichCompany(domain: string) {
      const res = (await httpJson("apollo", `${BASE}/organizations/enrich?${qs({ domain: normalizeDomain(domain) })}`, { method: "GET", headers })) as {
        organization?: ApolloOrg;
      };
      return res.organization ? toCompany(res.organization) : null;
    },
    async findPeople(q: PersonQuery) {
      const params = qs({
        "q_organization_domains_list": [normalizeDomain(q.domain)],
        "person_titles": q.titles,
        "person_seniorities": q.seniorities,
        page: 1,
        per_page: Math.min(q.limit ?? 10, 100),
      });
      const res = (await httpJson("apollo", `${BASE}/mixed_people/api_search?${params}`, { method: "POST", headers })) as {
        people?: { id: string; first_name?: string; last_name?: string; last_name_obfuscated?: string; title?: string; linkedin_url?: string }[];
      };
      return (res.people ?? []).map(
        (p): Person => ({
          id: `apollo:${p.id}`,
          firstName: p.first_name ?? "",
          lastName: p.last_name ?? p.last_name_obfuscated ?? "",
          title: p.title ?? "",
          domain: normalizeDomain(q.domain),
          seniority: seniorityOf(p.title ?? ""),
          linkedin: p.linkedin_url,
          source: "apollo",
        }),
      );
    },
    async matchPerson(p) {
      const id = p.id?.startsWith("apollo:") ? p.id.slice(7) : undefined;
      const params = qs({
        id,
        first_name: id ? undefined : p.firstName,
        last_name: id ? undefined : p.lastName,
        domain: normalizeDomain(p.domain),
        reveal_personal_emails: false,
      });
      const res = (await httpJson("apollo", `${BASE}/people/match?${params}`, { method: "POST", headers })) as {
        person?: { email?: string; email_status?: string; linkedin_url?: string; title?: string; first_name?: string; last_name?: string };
      };
      if (!res.person) return null;
      const m: MatchedPerson = {
        email: res.person.email && !/email_not_unlocked|domain\.com$/i.test(res.person.email) ? res.person.email : undefined,
        emailStatus: res.person.email_status,
        linkedin: res.person.linkedin_url,
        title: res.person.title,
        firstName: res.person.first_name,
        lastName: res.person.last_name,
      };
      return m;
    },
    async jobPostings(company: Company) {
      if (!company.providerId) return [];
      const res = (await httpJson("apollo", `${BASE}/organizations/${encodeURIComponent(company.providerId)}/job_postings?${qs({ page: 1, per_page: 50 })}`, {
        method: "GET",
        headers,
      })) as { organization_job_postings?: { title?: string; url?: string; posted_at?: string; last_seen_at?: string; country?: string }[] };
      return (res.organization_job_postings ?? []).map(
        (j): Signal => ({
          type: "hiring",
          title: `Hiring: ${j.title ?? "open role"}`,
          detail: j.country ? `Location: ${j.country}` : undefined,
          url: j.url,
          date: j.posted_at ?? j.last_seen_at ?? new Date().toISOString(),
          source: "apollo",
        }),
      );
    },
    async companySignals(c: Company) {
      const out: Signal[] = [];
      if (c.lastFundingDate) {
        out.push({
          type: "funding",
          title: `Raised ${c.fundingStage ? titleCase(c.fundingStage.replace(/_/g, " ")) : "a funding round"}`,
          date: new Date(c.lastFundingDate).toISOString(),
          source: "apollo",
        });
      }
      if (typeof c.headcountGrowth6m === "number" && c.headcountGrowth6m >= 0.1) {
        out.push({
          type: "headcount_growth",
          title: `Headcount up ${Math.round(c.headcountGrowth6m * 100)}% in 6 months`,
          date: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          source: "apollo",
        });
      }
      return out;
    },
  };
}
