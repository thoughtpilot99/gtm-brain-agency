import fs from "node:fs";
import { parseCsv } from "./csv";
import { all, get, json, now, run, tx } from "./db";
import { getClient, safePath } from "./brain/workspace";
import { normalizeDomain, splitList } from "./traits";
import type { DealRow } from "./types";
import { upsertAccount } from "./accounts";

/**
 * CRM exports live in workspaces/<client>/data/:
 *  closed-won.csv / closed-lost.csv  company,domain,industry,employees,region,tech,signer_title,deal_value,closed_at
 *  crm-contacts.csv                  email,domain,company,status   (status: customer | open_opp | contacted | do_not_contact)
 *  target-accounts.csv               company,domain,industry,employees,region,tech   (optional account list to score)
 */
export const CRM_FILES = {
  won: "data/closed-won.csv",
  lost: "data/closed-lost.csv",
  contacts: "data/crm-contacts.csv",
  targets: "data/target-accounts.csv",
} as const;

export interface ImportSummary {
  won: number;
  lost: number;
  contacts: number;
  targets: number;
  customers: number;
  skipped: string[];
  missing: string[];
}

function readCsv(slug: string, rel: string): Record<string, string>[] | null {
  const p = safePath(slug, rel);
  if (!fs.existsSync(p)) return null;
  return parseCsv(fs.readFileSync(p, "utf8"));
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
  return "";
};

export function importCrm(slug: string): ImportSummary {
  getClient(slug);
  const summary: ImportSummary = { won: 0, lost: 0, contacts: 0, targets: 0, customers: 0, skipped: [], missing: [] };
  const won = readCsv(slug, CRM_FILES.won);
  const lost = readCsv(slug, CRM_FILES.lost);
  const contacts = readCsv(slug, CRM_FILES.contacts);
  const targets = readCsv(slug, CRM_FILES.targets);
  if (!won) summary.missing.push(CRM_FILES.won);
  if (!lost) summary.missing.push(CRM_FILES.lost);

  tx(() => {
    const ts = now();
    for (const [kind, rows] of [
      ["won", won],
      ["lost", lost],
    ] as const) {
      if (!rows) continue;
      run("DELETE FROM crm_records WHERE client = ? AND kind = ?", slug, kind);
      rows.forEach((r, i) => {
        const domain = normalizeDomain(pick(r, "domain", "website", "company_domain"));
        const company = pick(r, "company", "company_name", "account", "name");
        if (!domain && !company) {
          summary.skipped.push(`${kind} row ${i + 2}: no company or domain`);
          return;
        }
        run(
          "INSERT INTO crm_records (client, kind, company, domain, email, status, data, imported_at) VALUES (?,?,?,?,?,?,?,?)",
          slug,
          kind,
          company,
          domain,
          null,
          kind === "won" ? "customer" : "lost",
          JSON.stringify(r),
          ts,
        );
        summary[kind]++;
        if (kind === "won") summary.customers++;
      });
    }
    if (contacts) {
      run("DELETE FROM crm_records WHERE client = ? AND kind = 'contact'", slug);
      for (const r of contacts) {
        const email = pick(r, "email", "email_address").toLowerCase();
        const domain = normalizeDomain(pick(r, "domain", "website") || email.split("@")[1]);
        const status = (pick(r, "status", "lifecycle_stage") || "contacted").toLowerCase().replace(/[\s-]+/g, "_");
        run(
          "INSERT INTO crm_records (client, kind, company, domain, email, status, data, imported_at) VALUES (?,?,?,?,?,?,?,?)",
          slug,
          "contact",
          pick(r, "company"),
          domain,
          email || null,
          status,
          JSON.stringify(r),
          ts,
        );
        summary.contacts++;
      }
    }
    if (targets) {
      for (const r of targets) {
        const domain = normalizeDomain(pick(r, "domain", "website"));
        if (!domain) continue;
        upsertAccount(slug, {
          domain,
          name: pick(r, "company", "name") || domain,
          industry: pick(r, "industry") || undefined,
          employees: Number(pick(r, "employees", "headcount")) || undefined,
          region: pick(r, "region") || undefined,
          country: pick(r, "country") || undefined,
          tech: splitList(pick(r, "tech", "technologies")),
          source: "crm-import",
        });
        summary.targets++;
      }
    }
  });
  return summary;
}

export function deals(slug: string): DealRow[] {
  return all<{ kind: string; data: string; company: string; domain: string }>(
    "SELECT kind, data, company, domain FROM crm_records WHERE client = ? AND kind IN ('won','lost')",
    slug,
  ).map((r) => {
    const d = json<Record<string, string>>(r.data, {});
    return {
      company: r.company,
      domain: r.domain,
      industry: pick(d, "industry"),
      employees: Number(pick(d, "employees", "headcount", "company_size")) || 0,
      region: pick(d, "region", "geo"),
      tech: splitList(pick(d, "tech", "technologies", "tools")),
      signerTitle: pick(d, "signer_title", "title", "champion_title", "buyer_title"),
      dealValue: Number(pick(d, "deal_value", "amount", "acv")) || undefined,
      closedAt: pick(d, "closed_at", "close_date") || undefined,
      outcome: r.kind as "won" | "lost",
    };
  });
}

/** Why an account or person must not be prospected, or null when it is fine. */
export function suppressionReason(slug: string, domain: string, email?: string): string | null {
  const d = normalizeDomain(domain);
  const customer = get<{ company: string }>(
    "SELECT company FROM crm_records WHERE client = ? AND domain = ? AND (kind = 'won' OR status = 'customer') LIMIT 1",
    slug,
    d,
  );
  if (customer) return "existing customer";
  const opp = get("SELECT 1 FROM crm_records WHERE client = ? AND domain = ? AND status = 'open_opp' LIMIT 1", slug, d);
  if (opp) return "open opportunity in CRM";
  const dnc = get("SELECT 1 FROM crm_records WHERE client = ? AND domain = ? AND status = 'do_not_contact' AND (email IS NULL OR email = '') LIMIT 1", slug, d);
  if (dnc) return "account marked do-not-contact";
  if (email) {
    const e = get<{ status: string }>(
      "SELECT status FROM crm_records WHERE client = ? AND email = ? LIMIT 1",
      slug,
      email.toLowerCase(),
    );
    if (e) return e.status === "do_not_contact" ? "person marked do-not-contact" : `already in CRM (${e.status.replace(/_/g, " ")})`;
  }
  return null;
}

export function crmStats(slug: string) {
  const rows = all<{ kind: string; n: number }>(
    "SELECT kind, COUNT(*) AS n FROM crm_records WHERE client = ? GROUP BY kind",
    slug,
  );
  const by = Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
  return { won: by.won ?? 0, lost: by.lost ?? 0, contacts: by.contact ?? 0 };
}
