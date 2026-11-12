import type { EmailStatus } from "../types";
import { normalizeDomain } from "../traits";
import { httpJson, type DataProvider } from "./types";

export function hunterProvider(apiKey: string): DataProvider {
  const base = "https://api.hunter.io/v2";
  return {
    name: "hunter",
    live: true,
    async findEmail(p) {
      const params = new URLSearchParams({ domain: normalizeDomain(p.domain), first_name: p.firstName, last_name: p.lastName, api_key: apiKey });
      const res = (await httpJson("hunter", `${base}/email-finder?${params}`)) as { data?: { email?: string | null; score?: number } };
      return { email: res.data?.email ?? null, score: res.data?.score };
    },
    async verifyEmail(email) {
      const params = new URLSearchParams({ email, api_key: apiKey });
      const res = (await httpJson("hunter", `${base}/email-verifier?${params}`, {}, 40000)) as { data?: { status?: string; result?: string } };
      const raw = res.data?.status ?? res.data?.result ?? "unknown";
      const map: Record<string, EmailStatus> = {
        valid: "verified",
        deliverable: "verified",
        accept_all: "catch_all",
        webmail: "risky",
        risky: "risky",
        unknown: "risky",
        disposable: "invalid",
        invalid: "invalid",
        undeliverable: "invalid",
      };
      return { status: map[raw] ?? "risky", raw };
    },
  };
}

export function zeroBounceProvider(apiKey: string): DataProvider {
  return {
    name: "zerobounce",
    live: true,
    async verifyEmail(email) {
      const params = new URLSearchParams({ api_key: apiKey, email, ip_address: "" });
      const res = (await httpJson("zerobounce", `https://api.zerobounce.net/v2/validate?${params}`, {}, 40000)) as { status?: string; error?: string };
      if (res.error) throw new Error(`zerobounce: ${res.error}`);
      const raw = res.status ?? "unknown";
      const map: Record<string, EmailStatus> = {
        valid: "verified",
        "catch-all": "catch_all",
        unknown: "risky",
        invalid: "invalid",
        spamtrap: "invalid",
        abuse: "invalid",
        do_not_mail: "invalid",
      };
      return { status: map[raw] ?? "risky", raw };
    },
  };
}

/** Map Apollo's email_status to ours. Only "verified" lets the waterfall stop early. */
export function mapApolloStatus(s: string | undefined): EmailStatus {
  if (!s) return "unverified";
  if (s === "verified") return "verified";
  if (/unavailable|bounced|invalid/.test(s)) return "invalid";
  return "unverified";
}
