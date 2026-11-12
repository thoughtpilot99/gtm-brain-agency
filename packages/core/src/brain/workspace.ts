import fs from "node:fs";
import path from "node:path";
import { WORKSPACES_DIR } from "../env";
import { all, get, now, run } from "../db";
import { slugify } from "../traits";
import { ICP_TEMPLATE, OFFERS_TEMPLATE, RULES_TEMPLATE, README_FOLDERS, agentsMd } from "./templates";

export interface Client {
  slug: string;
  name: string;
  owner: string;
  website?: string | null;
  demo: boolean;
  creditBudget: number;
  createdAt: string;
}

type ClientRow = {
  slug: string;
  name: string;
  owner: string;
  website: string | null;
  demo: number;
  credit_budget: number;
  created_at: string;
};

const toClient = (r: ClientRow): Client => ({
  slug: r.slug,
  name: r.name,
  owner: r.owner,
  website: r.website,
  demo: !!r.demo,
  creditBudget: r.credit_budget,
  createdAt: r.created_at,
});

export class GtmError extends Error {
  constructor(
    message: string,
    public code: string = "bad_request",
  ) {
    super(message);
  }
}

export function workspaceDir(slug: string): string {
  return path.join(WORKSPACES_DIR, slug);
}

/** Resolve a brain-relative path and refuse anything that escapes the client's folder. */
export function safePath(slug: string, rel: string): string {
  const base = path.resolve(workspaceDir(slug));
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(base, clean);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GtmError(`Path "${rel}" is outside the brain folder`, "path_outside_brain");
  }
  return target;
}

export function listClients(): Client[] {
  return all<ClientRow>("SELECT * FROM clients ORDER BY demo DESC, name").map(toClient);
}

export function getClient(slug: string): Client {
  const r = get<ClientRow>("SELECT * FROM clients WHERE slug = ?", slug);
  if (!r) {
    const known = listClients().map((c) => c.slug);
    throw new GtmError(
      `Unknown client "${slug}". Known clients: ${known.length ? known.join(", ") : "none. Run gtm init <name>"}`,
      "unknown_client",
    );
  }
  return toClient(r);
}

export function createClient(input: {
  name: string;
  owner: string;
  slug?: string;
  website?: string;
  demo?: boolean;
  creditBudget?: number;
}): Client {
  const slug = slugify(input.slug ?? input.name);
  if (!slug) throw new GtmError("Client name must contain letters or numbers");
  if (get("SELECT slug FROM clients WHERE slug = ?", slug)) throw new GtmError(`Client "${slug}" already exists`, "exists");
  const dir = workspaceDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "AGENTS.md": agentsMd(input.name),
    "CLAUDE.md": "@AGENTS.md\n\n## Extra rules\nAsk before you send anything to a sequencer.\n",
    "icp.md": ICP_TEMPLATE,
    "offers.md": OFFERS_TEMPLATE,
    "rules.md": RULES_TEMPLATE,
    ...README_FOLDERS,
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = safePath(slug, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, content, "utf8");
  }
  run(
    "INSERT INTO clients (slug, name, owner, website, demo, credit_budget, created_at) VALUES (?,?,?,?,?,?,?)",
    slug,
    input.name,
    input.owner,
    input.website ?? null,
    input.demo ? 1 : 0,
    input.creditBudget ?? 2000,
    now(),
  );
  for (const rel of ["icp.md", "offers.md", "rules.md"]) recordVersion(slug, rel, readBrainFile(slug, rel) ?? "", "system", "created");
  return getClient(slug);
}

export function updateClient(slug: string, patch: { owner?: string; creditBudget?: number; website?: string }): Client {
  getClient(slug);
  if (patch.owner) run("UPDATE clients SET owner = ? WHERE slug = ?", patch.owner, slug);
  if (patch.creditBudget !== undefined) run("UPDATE clients SET credit_budget = ? WHERE slug = ?", patch.creditBudget, slug);
  if (patch.website !== undefined) run("UPDATE clients SET website = ? WHERE slug = ?", patch.website, slug);
  return getClient(slug);
}

export function readBrainFile(slug: string, rel: string): string | null {
  const p = safePath(slug, rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
  return fs.readFileSync(p, "utf8");
}

export interface BrainFile {
  path: string;
  bytes: number;
  modifiedAt: string;
  kind: "core" | "product" | "campaign" | "call-note" | "data" | "instructions" | "other";
}

function kindOf(rel: string): BrainFile["kind"] {
  if (/^(icp|offers|rules)\.md$/.test(rel)) return "core";
  if (/^(AGENTS|CLAUDE)\.md$/.test(rel)) return "instructions";
  if (rel.startsWith("products/")) return "product";
  if (rel.startsWith("past-campaigns/")) return "campaign";
  if (rel.startsWith("call-notes/")) return "call-note";
  if (rel.startsWith("data/")) return "data";
  return "other";
}

export function listBrainFiles(slug: string): BrainFile[] {
  const base = workspaceDir(slug);
  const out: BrainFile[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(base, full).replace(/\\/g, "/");
        const st = fs.statSync(full);
        out.push({ path: rel, bytes: st.size, modifiedAt: st.mtime.toISOString(), kind: kindOf(rel) });
      }
    }
  };
  walk(base);
  const order = ["instructions", "core", "product", "call-note", "campaign", "data", "other"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.path.localeCompare(b.path));
}

/** Direct write. Used for logs (past campaigns, call notes, data) and for approved proposals. */
export function writeBrainFile(slug: string, rel: string, content: string, author: string, note?: string, proposalId?: number) {
  const p = safePath(slug, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
  recordVersion(slug, rel, content, author, note, proposalId);
}

export function recordVersion(slug: string, rel: string, content: string, author: string, note?: string, proposalId?: number) {
  run(
    "INSERT INTO versions (client, path, content, author, note, proposal_id, created_at) VALUES (?,?,?,?,?,?,?)",
    slug,
    rel,
    content,
    author,
    note ?? null,
    proposalId ?? null,
    now(),
  );
}

/** Files that only change through an approved proposal. */
export function isProtected(rel: string): boolean {
  return /^(icp|offers|rules)\.md$/.test(rel) || rel.startsWith("products/") || /^(AGENTS|CLAUDE)\.md$/.test(rel);
}

export function listDir(slug: string, rel: string): string[] {
  const p = safePath(slug, rel);
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p)
    .filter((f) => !f.startsWith("."))
    .map((f) => `${rel.replace(/\/$/, "")}/${f}`);
}
