/** Normalizers that turn raw CRM / provider fields into comparable traits. */

export const SIZE_BUCKETS: { label: string; min: number; max: number; apollo: string }[] = [
  { label: "1-10", min: 1, max: 10, apollo: "1,10" },
  { label: "11-50", min: 11, max: 50, apollo: "11,50" },
  { label: "51-200", min: 51, max: 200, apollo: "51,200" },
  { label: "201-500", min: 201, max: 500, apollo: "201,500" },
  { label: "501-1000", min: 501, max: 1000, apollo: "501,1000" },
  { label: "1001-5000", min: 1001, max: 5000, apollo: "1001,5000" },
  { label: "5001+", min: 5001, max: Number.MAX_SAFE_INTEGER, apollo: "5001,1000000" },
];

export function sizeBucket(employees: number | undefined | null): string | undefined {
  if (!employees || employees <= 0 || Number.isNaN(employees)) return undefined;
  return SIZE_BUCKETS.find((b) => employees >= b.min && employees <= b.max)?.label;
}

export function seniorityOf(title: string | undefined): string {
  const t = (title ?? "").toLowerCase();
  if (!t) return "Unknown";
  if (/\b(founder|co-founder|owner|ceo|cto|cfo|coo|cmo|cro|chief|president)\b/.test(t)) return "Founder/C-level";
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return "VP";
  if (/\b(head|director)\b/.test(t)) return "Head/Director";
  if (/\b(manager|lead|team lead)\b/.test(t)) return "Manager";
  return "Individual contributor";
}

export function functionOf(title: string | undefined): string {
  const t = (title ?? "").toLowerCase();
  if (!t) return "Unknown";
  if (/rev ?ops|revenue operations|sales ops|gtm ops|go-to-market ops/.test(t)) return "RevOps";
  if (/\b(cro|revenue)\b/.test(t)) return "Revenue";
  if (/sales|account exec|business development|\bsdr\b|\bbdr\b/.test(t)) return "Sales";
  if (/growth|demand gen|demand generation/.test(t)) return "Growth";
  if (/market|\bcmo\b|brand/.test(t)) return "Marketing";
  if (/engineer|\bcto\b|developer|technology|technical/.test(t)) return "Engineering";
  if (/financ|\bcfo\b|account(ing|ant)/.test(t)) return "Finance";
  if (/operat|\bcoo\b/.test(t)) return "Operations";
  if (/\b(ceo|founder|owner|president)\b/.test(t)) return "Executive";
  return "Other";
}

export function normalizeDomain(input: string | undefined | null): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function splitList(v: string | undefined | null): string[] {
  if (!v) return [];
  return v
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Traits for a company-level record, used by both ICP lift and account scoring. */
export function companyTraits(c: {
  industry?: string;
  employees?: number;
  region?: string;
  tech?: string[];
}): { dimension: string; value: string }[] {
  const out: { dimension: string; value: string }[] = [];
  if (c.industry) out.push({ dimension: "industry", value: c.industry });
  const size = sizeBucket(c.employees);
  if (size) out.push({ dimension: "company_size", value: size });
  if (c.region) out.push({ dimension: "region", value: c.region });
  for (const t of c.tech ?? []) out.push({ dimension: "tech", value: t });
  return out;
}

/**
 * CRM industry labels ("B2B SaaS", "DevTools") rarely equal a data vendor's taxonomy ("Software Development").
 * Each known label maps to patterns over the vendor industry and, failing that, the company description.
 */
export const INDUSTRY_ALIASES: Record<string, RegExp> = {
  "b2b saas": /\bsaas\b|software as a service|software development|computer software|enterprise software|b2b software/i,
  saas: /\bsaas\b|software as a service|software development|computer software/i,
  devtools: /developer|devops|devtools|\bapi\b|\bsdk\b|open[- ]source|infrastructure software|ci\/cd|observability/i,
  "developer tools": /developer|devops|devtools|\bapi\b|\bsdk\b|observability/i,
  cybersecurity: /security|cyber|\bsiem\b|threat|identity (and|&) access|zero[- ]trust/i,
  security: /security|cyber/i,
  fintech: /fintech|financial (services|technology|software)|payments?|lending|banking software|\bneobank/i,
  "healthcare it": /health ?care|hospital|medical|clinical|health tech|healthtech/i,
  healthtech: /health ?care|medical|clinical|health tech|healthtech/i,
  "e-commerce platform": /e-?commerce|online retail|shopify|storefront/i,
  ecommerce: /e-?commerce|online retail|storefront/i,
  "logistics software": /logistics|supply chain|freight|shipping|warehous/i,
  "legal tech": /legal|law practice|law firm|contract management/i,
  marketing: /marketing|advertising/i,
  martech: /marketing (technology|software|automation)|martech/i,
  hr: /human resources|\bhr\b|recruit|staffing|payroll/i,
  "hr tech": /human resources software|\bhr tech|hris|payroll software|recruiting software/i,
  edtech: /e-?learning|education technology|edtech/i,
  insurtech: /insurance/i,
  proptech: /real estate|property/i,
};

/** Does an ICP industry label describe this company? Vendor industry first, description only as fallback. */
export function industryMatches(label: string, industry?: string, description?: string): "industry" | "description" | null {
  const l = label.trim().toLowerCase();
  if (!l) return null;
  const re = INDUSTRY_ALIASES[l] ?? new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (industry && (industry.toLowerCase() === l || re.test(industry))) return "industry";
  if (description && re.test(description)) return "description";
  return null;
}

/** "Gong.io", "HubSpot CRM", "hubspot" -> comparable keys. */
export function techKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/\.(io|com|ai|co|app)\b/g, "")
    .replace(/\b(crm|inc|software)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Companies that are rarely buyers of B2B software, whatever the keyword match says. */
export const NON_BUYER_INDUSTRIES = /advertising services|marketing services|venture capital|private equity|higher education|primary and secondary|staffing and recruiting|business consulting|non-?profit|government administration|religious|individual & family|think tanks|civic and social|professional training|education administration/i;
