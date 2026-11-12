import { all, get, now, run } from "../db";
import { GtmError, getClient, readBrainFile, writeBrainFile } from "./workspace";

export interface Proposal {
  id: number;
  client: string;
  path: string;
  before: string;
  after: string;
  reason: string;
  author: string;
  status: "pending" | "approved" | "rejected" | "superseded";
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt: string;
  diff: DiffLine[];
  stats: { added: number; removed: number };
}

export interface DiffLine {
  op: "same" | "add" | "del";
  text: string;
}

/** Line diff via LCS. Fine for brain-sized Markdown files. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [...a.map((t) => ({ op: "del" as const, text: t })), ...b.map((t) => ({ op: "add" as const, text: t }))];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

type ProposalRow = {
  id: number;
  client: string;
  path: string;
  before: string;
  after: string;
  reason: string;
  author: string;
  status: Proposal["status"];
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

function toProposal(r: ProposalRow): Proposal {
  const diff = diffLines(r.before, r.after);
  return {
    id: r.id,
    client: r.client,
    path: r.path,
    before: r.before,
    after: r.after,
    reason: r.reason,
    author: r.author,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
    diff,
    stats: { added: diff.filter((d) => d.op === "add").length, removed: diff.filter((d) => d.op === "del").length },
  };
}

export function propose(slug: string, rel: string, after: string, reason: string, author: string): Proposal {
  getClient(slug);
  const before = readBrainFile(slug, rel) ?? "";
  if (before === after) throw new GtmError(`No change: ${rel} already has this content`, "no_change");
  // A newer proposal for the same file replaces older pending ones.
  run("UPDATE proposals SET status = 'superseded' WHERE client = ? AND path = ? AND status = 'pending'", slug, rel);
  const { lastInsertRowid } = run(
    "INSERT INTO proposals (client, path, before, after, reason, author, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)",
    slug,
    rel,
    before,
    after,
    reason,
    author,
    now(),
  );
  return getProposal(slug, lastInsertRowid);
}

export function getProposal(slug: string, id: number): Proposal {
  const r = get<ProposalRow>("SELECT * FROM proposals WHERE client = ? AND id = ?", slug, id);
  if (!r) throw new GtmError(`Proposal #${id} not found for ${slug}`, "not_found");
  return toProposal(r);
}

export function listProposals(slug: string, status?: Proposal["status"] | "all"): Proposal[] {
  const rows =
    status && status !== "all"
      ? all<ProposalRow>("SELECT * FROM proposals WHERE client = ? AND status = ? ORDER BY id DESC", slug, status)
      : all<ProposalRow>("SELECT * FROM proposals WHERE client = ? ORDER BY id DESC LIMIT 200", slug);
  return rows.map(toProposal);
}

/**
 * Approve or reject. Only the client's brain owner may decide (the "one owner" rule).
 * Approval refuses to apply if the file changed since the proposal was made.
 */
export function decideProposal(slug: string, id: number, approve: boolean, decidedBy: string): Proposal {
  const client = getClient(slug);
  if (decidedBy.trim().toLowerCase() !== client.owner.trim().toLowerCase()) {
    throw new GtmError(
      `Only the brain owner (${client.owner}) can approve or reject changes. "${decidedBy}" is not the owner.`,
      "not_owner",
    );
  }
  const p = getProposal(slug, id);
  if (p.status !== "pending") throw new GtmError(`Proposal #${id} is already ${p.status}`, "not_pending");
  if (approve) {
    const current = readBrainFile(slug, p.path) ?? "";
    if (current !== p.before) {
      run("UPDATE proposals SET status = 'superseded', decided_by = ?, decided_at = ? WHERE id = ?", decidedBy, now(), id);
      throw new GtmError(`${p.path} changed after this proposal was made. Ask for a fresh proposal.`, "stale");
    }
    writeBrainFile(slug, p.path, p.after, p.author, `approved by ${decidedBy}: ${p.reason}`, id);
  }
  run(
    "UPDATE proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
    approve ? "approved" : "rejected",
    decidedBy,
    now(),
    id,
  );
  return getProposal(slug, id);
}

export interface Version {
  id: number;
  path: string;
  author: string;
  note: string | null;
  proposalId: number | null;
  createdAt: string;
  bytes: number;
}

export function listVersions(slug: string, rel?: string): Version[] {
  const rows = rel
    ? all<Record<string, unknown>>("SELECT * FROM versions WHERE client = ? AND path = ? ORDER BY id DESC", slug, rel)
    : all<Record<string, unknown>>("SELECT * FROM versions WHERE client = ? ORDER BY id DESC LIMIT 200", slug);
  return rows.map((r) => ({
    id: r.id as number,
    path: r.path as string,
    author: r.author as string,
    note: (r.note as string) ?? null,
    proposalId: (r.proposal_id as number) ?? null,
    createdAt: r.created_at as string,
    bytes: String(r.content).length,
  }));
}

/** Rollback is itself a proposal, so it still goes through the owner. */
export function proposeRollback(slug: string, versionId: number, author: string): Proposal {
  const v = get<{ path: string; content: string; created_at: string }>(
    "SELECT path, content, created_at FROM versions WHERE client = ? AND id = ?",
    slug,
    versionId,
  );
  if (!v) throw new GtmError(`Version #${versionId} not found`, "not_found");
  return propose(slug, v.path, v.content, `Roll back ${v.path} to the version from ${v.created_at}`, author);
}
