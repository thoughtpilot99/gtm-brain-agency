export type SignalType =
  | "funding"
  | "hiring"
  | "leadership_change"
  | "tech_adoption"
  | "headcount_growth"
  | "web_intent"
  | "news";

export interface Signal {
  type: SignalType;
  title: string;
  detail?: string;
  url?: string;
  /** ISO date the event happened (or was observed). */
  date: string;
  source: string;
}

export interface Company {
  name: string;
  domain: string;
  industry?: string;
  employees?: number;
  region?: string;
  country?: string;
  tech?: string[];
  description?: string;
  linkedin?: string;
  providerId?: string;
  fundingStage?: string;
  lastFundingDate?: string;
  headcountGrowth6m?: number;
  /** USD raised in the last primary round, when the provider gives it. */
  lastFundingAmount?: number;
  source: string;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  domain: string;
  seniority?: string;
  linkedin?: string;
  email?: string;
  emailStatus?: EmailStatus;
  source: string;
}

export type EmailStatus = "verified" | "catch_all" | "risky" | "invalid" | "not_found" | "unverified";

export interface WaterfallStep {
  provider: string;
  action: string;
  outcome: string;
  credits: number;
  cached: boolean;
}

export interface EmailResult {
  email: string | null;
  status: EmailStatus;
  steps: WaterfallStep[];
}

export interface Account {
  client: string;
  domain: string;
  name: string;
  industry?: string;
  employees?: number;
  region?: string;
  country?: string;
  tech: string[];
  description?: string;
  source?: string;
  signals: Signal[];
  score?: number;
  fit?: number;
  intent?: number;
  tier?: string;
  reasons: string[];
  suppressed?: string | null;
  scoredAt?: string;
}

/** A deal row from the CRM export (closed-won / closed-lost). */
export interface DealRow {
  company: string;
  domain: string;
  industry: string;
  employees: number;
  region: string;
  tech: string[];
  signerTitle: string;
  dealValue?: number;
  closedAt?: string;
  outcome: "won" | "lost";
}
