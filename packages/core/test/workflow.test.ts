import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import {
  createClient,
  safePath,
  importCrm,
  buildIcp,
  scoreAccounts,
  listAccounts,
  DataGateway,
  writeEmail,
  closeCampaign,
  recommend,
  propose,
  decideProposal,
  proposeRollback,
  readBrainFile,
  brainHealth,
  runBatches,
  runTool,
  TOOLS,
  toolJsonSchemas,
  spendReport,
  GtmError,
} from "../src/index";

const OWNER = "Sam Rivera";
const slug = "testco";

beforeAll(async () => {
  createClient({ name: "TestCo", slug, owner: OWNER, demo: true });
  const src = path.join(import.meta.dirname, "fixtures", "sample-client");
  const copy = (rel: string) => {
    for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) copy(r);
      else {
        const to = safePath(slug, r);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(path.join(src, r), to);
      }
    }
  };
  copy("");
});

describe("end-to-end workflow on sample data", () => {
  it("refuses paths outside the brain folder", () => {
    expect(() => safePath(slug, "../../etc/passwd")).toThrow(GtmError);
  });

  it("imports CRM exports", () => {
    const s = importCrm(slug);
    expect(s.won).toBeGreaterThan(20);
    expect(s.lost).toBeGreaterThan(20);
    expect(s.targets).toBeGreaterThan(100);
  });

  it("files a non-owner ICP build as a proposal, and lets the owner apply it", async () => {
    const asAgent = await buildIcp(slug, { author: "claude-code", apply: true, narrate: false });
    expect(asAgent.applied).toBe(false);
    expect(asAgent.proposal?.status).toBe("pending");
    const asOwner = await buildIcp(slug, { author: OWNER, apply: true, narrate: false });
    expect(asOwner.applied).toBe(true);
    expect(readBrainFile(slug, "icp.md")).toContain("Lift");
  });

  it("scores accounts in batches and suppresses existing customers", async () => {
    const r = await scoreAccounts(slug, { refreshSignals: true });
    expect(r.progress.status).toBe("done");
    expect(r.tiers["Suppressed"]).toBeGreaterThanOrEqual(3);
    const top = listAccounts(slug, { limit: 5 });
    expect(top[0].score).toBeGreaterThanOrEqual(top[4].score ?? 0);
    expect(top[0].reasons.length).toBeGreaterThan(0);
  });

  it("runs the email waterfall and records each step", async () => {
    const gw = new DataGateway(slug);
    const a = listAccounts(slug, { limit: 1 })[0];
    const [p] = await gw.findPeople(a.domain, undefined, 1);
    const r = await gw.findEmail({ id: p.id, firstName: p.firstName, lastName: p.lastName, domain: a.domain });
    expect(r.steps.length).toBeGreaterThan(0);
    expect(["verified", "catch_all", "risky", "invalid", "not_found", "unverified"]).toContain(r.status);
  });

  it("blocks the waterfall for suppressed accounts", async () => {
    const suppressed = listAccounts(slug, { tier: "Suppressed", includeSuppressed: true, limit: 1 })[0];
    const r = await new DataGateway(slug).findEmail({ firstName: "A", lastName: "B", domain: suppressed.domain });
    expect(r.suppressed).toBeTruthy();
    expect(r.email).toBeNull();
  });

  it("caches repeat lookups", async () => {
    const gw = new DataGateway(slug);
    const a = listAccounts(slug, { limit: 1 })[0];
    await gw.enrichCompany(a.domain);
    await gw.enrichCompany(a.domain);
    expect(spendReport(slug).cacheHitRate).toBeGreaterThan(0);
  });

  it("writes a template draft with a fully supported claim ledger", async () => {
    const a = listAccounts(slug, { limit: 1 })[0];
    const d = await writeEmail(slug, { domain: a.domain, contact: { firstName: "Maya" }, useClaude: false });
    expect(d.writer).toBe("template");
    expect(d.claims.every((c) => c.supported)).toBe(true);
    expect(d.verdict).not.toBe("blocked");
    expect(d.lint.words).toBeLessThanOrEqual(90);
  });

  it("closes campaigns, writes the file and proposes learnings", () => {
    const r = closeCampaign(slug, { name: "Seg test", resultsCsv: "data/campaign-results.csv", author: OWNER });
    expect(fs.existsSync(safePath(slug, r.file))).toBe(true);
    expect(r.segments.length).toBeGreaterThan(1);
    expect(recommend(slug).recommendations.length).toBeGreaterThan(0);
  });

  it("enforces the one-owner rule and stale checks on proposals", () => {
    const before = readBrainFile(slug, "rules.md")!;
    const p = propose(slug, "rules.md", before + "\n- extra rule\n", "test", "codex");
    expect(() => decideProposal(slug, p.id, true, "codex")).toThrow(/owner/);
    const ok = decideProposal(slug, p.id, true, OWNER);
    expect(ok.status).toBe("approved");
    expect(readBrainFile(slug, "rules.md")).toContain("extra rule");

    const p2 = propose(slug, "rules.md", "changed", "test", "codex");
    fs.writeFileSync(safePath(slug, "rules.md"), "edited by hand");
    expect(() => decideProposal(slug, p2.id, true, OWNER)).toThrow(/changed after/);
  });

  it("proposes a rollback to an earlier version", () => {
    const r = proposeRollback(slug, 1, "claude-code");
    expect(r.status).toBe("pending");
  });

  it("reports brain health with fixes", () => {
    const h = brainHealth(slug);
    expect(h.score).toBeGreaterThan(50);
    expect(h.checks.length).toBeGreaterThan(5);
  });

  it("resumes checkpointed batches", async () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const seen: number[] = [];
    const first = await runBatches(slug, "job-resume", "test", items, async (b) => void seen.push(...b), { stopAfterBatches: 1 });
    expect(first.status).toBe("paused");
    expect(first.done).toBe(100);
    const second = await runBatches(slug, "job-resume", "test", items, async (b) => void seen.push(...b));
    expect(second.status).toBe("done");
    expect(seen.length).toBe(250);
  });
});

describe("tool registry", () => {
  it("exposes valid JSON schemas for every tool", () => {
    const schemas = toolJsonSchemas();
    expect(schemas.length).toBe(TOOLS.length - 1);
    expect(schemas.some((x) => x.name === "decide_proposal")).toBe(false);
    for (const s of schemas) expect(s.input_schema.type).toBe("object");
  });
  it("validates input and returns structured errors", async () => {
    const bad = await runTool("read_brain", {}, { actor: "test" });
    expect(bad.ok).toBe(false);
    const unknown = await runTool("client_overview", { client: "nope" }, { actor: "test" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.code).toBe("unknown_client");
    const agentApprove = await runTool("decide_proposal", { client: slug, id: 1, approve: true, approver: OWNER }, { actor: "agent" });
    expect(agentApprove.ok).toBe(false);
    if (!agentApprove.ok) expect(agentApprove.code).toBe("human_only");
    const ok = await runTool("client_overview", { client: slug }, { actor: "test" });
    expect(ok.ok).toBe(true);
  });
});
