import type { Company, EmailStatus, Person, Signal } from "../types";

export interface CompanyQuery {
  keywords?: string[];
  industries?: string[];
  /** Employee ranges like "51,200". */
  employeeRanges?: string[];
  locations?: string[];
  technologies?: string[];
  /** Phrases or vendor industries that disqualify a company (agencies, VCs, the ICP's bad-fit industries). */
  excludeKeywords?: string[];
  excludeIndustries?: string[];
  /** Only companies whose last funding round was in this year or later (a fresh buying signal). */
  fundedSinceYear?: number;
  page?: number;
  limit?: number;
}

export interface PersonQuery {
  domain: string;
  titles?: string[];
  seniorities?: string[];
  limit?: number;
}

export interface MatchedPerson {
  email?: string;
  /** Raw provider status, mapped later. */
  emailStatus?: string;
  linkedin?: string;
  title?: string;
  firstName?: string;
  lastName?: string;
}

export interface VerifyResult {
  status: EmailStatus;
  raw: string;
}

/** Every capability is optional; the gateway picks the first provider that has it. */
export interface DataProvider {
  name: string;
  live: boolean;
  searchCompanies?(q: CompanyQuery): Promise<Company[]>;
  enrichCompany?(domain: string): Promise<Company | null>;
  findPeople?(q: PersonQuery): Promise<Person[]>;
  matchPerson?(p: { id?: string; firstName?: string; lastName?: string; domain: string }): Promise<MatchedPerson | null>;
  jobPostings?(company: Company): Promise<Signal[]>;
  companySignals?(company: Company): Promise<Signal[]>;
  /** `status` is set when the finder already verified the email, so the waterfall can stop without another check. */
  findEmail?(p: { firstName: string; lastName: string; domain: string; linkedin?: string }): Promise<{ email: string | null; score?: number; status?: EmailStatus }>;
  verifyEmail?(email: string): Promise<VerifyResult>;
  /** Providers that report their real charge per call (ColdIQ) return it here; it replaces the COSTS estimate. */
  takeCharge?(): number | undefined;
}

/** Credits and estimated USD per call, shown on the Spend page. Edit to match your plans. */
export const COSTS: Record<string, { credits: number; usd: number }> = {
  "apollo.searchCompanies": { credits: 1, usd: 0.02 },
  "apollo.enrichCompany": { credits: 1, usd: 0.02 },
  "apollo.findPeople": { credits: 0, usd: 0 },
  "apollo.matchPerson": { credits: 1, usd: 0.03 },
  "apollo.jobPostings": { credits: 1, usd: 0.02 },
  "hunter.findEmail": { credits: 1, usd: 0.034 },
  "hunter.verifyEmail": { credits: 0.5, usd: 0.017 },
  "zerobounce.verifyEmail": { credits: 1, usd: 0.008 },
  // ColdIQ estimates, used only for the budget check before a call. The ledger records what ColdIQ actually charged.
  "coldiq.searchCompanies": { credits: 1, usd: 0.014 },
  "coldiq.enrichCompany": { credits: 0.05, usd: 0.001 },
  "coldiq.findPeople": { credits: 1, usd: 0.014 },
  "coldiq.findEmail": { credits: 1.5, usd: 0.021 },
  "coldiq.verifyEmail": { credits: 0.75, usd: 0.011 },
  "coldiq.jobPostings": { credits: 12.6, usd: 0.18 },
};

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

export async function httpJson(provider: string, url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? "API key rejected or plan lacks access to this endpoint"
          : res.status === 402
            ? "out of credits, top up the provider account"
            : res.status === 409
              ? "the provider wants a spend confirmation for this call (it is above its auto-approve limit)"
              : res.status === 422
            ? "request rejected (check parameters)"
            : res.status === 429
              ? "rate limited, retry later"
              : `HTTP ${res.status}`;
      throw new ProviderError(provider, `${hint}: ${text.slice(0, 300)}`, res.status);
    }
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if ((e as Error).name === "AbortError") throw new ProviderError(provider, `timed out after ${timeoutMs}ms`);
    throw new ProviderError(provider, (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}
