/**
 * Connects to the MCP server over stdio exactly like Claude Code does, lists tools and runs a few.
 * It uses a throwaway database and brain folder filled from the test fixture, so your real clients are never touched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gtm-smoke-"));
const testEnv = {
  GTM_DB: path.join(tmp, "smoke.db"),
  GTM_WORKSPACES: path.join(tmp, "workspaces"),
  GTM_DEMO_MODE: "true",
  ANTHROPIC_API_KEY: "",
  APOLLO_API_KEY: "",
  HUNTER_API_KEY: "",
  ZEROBOUNCE_API_KEY: "",
  COLDIQ_API_KEY: "",
};
Object.assign(process.env, testEnv);
const { ROOT, createClient, writeBrainFile, importCrm, resetDb } = await import("../packages/core/src/index");

const fixture = path.join(ROOT, "packages/core/test/fixtures/sample-client");
const slug = "smoke-test";
createClient({ name: "Smoke Test", slug, owner: "Test Owner", demo: true });
const copy = (rel = "") => {
  for (const e of fs.readdirSync(path.join(fixture, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) copy(r);
    else writeBrainFile(slug, r, fs.readFileSync(path.join(fixture, r), "utf8"), "smoke", "fixture");
  }
};
copy();
importCrm(slug);

// Same launch command as .mcp.json: plain node with the tsx loader (no .cmd shims, works on Windows/macOS/Linux).
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", path.join(ROOT, "apps/mcp/src/stdio.ts")],
  cwd: ROOT,
  env: { ...(process.env as Record<string, string>), ...testEnv, GTM_ACTOR: "mcp-smoke" },
  stderr: "pipe",
});
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length} (${tools.map((t) => t.name).join(", ")})`);

const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = r.content[0]?.text ?? "";
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text);
};

const clients = await call("list_clients", {});
if (!clients.some((c: { slug: string }) => c.slug === slug)) throw new Error("Test client missing from list_clients");
const icp = await call("build_icp", { client: slug });
console.log(`build_icp: ${icp.core.length} core traits, proposal ${icp.proposalId ?? "none (unchanged)"}`);
const scored = await call("score_accounts", { client: slug });
console.log(`score_accounts: ${JSON.stringify(scored.tiers)}`);
const top = await call("top_accounts", { client: slug, limit: 1 });
const draft = await call("write_email", { client: slug, domain: top[0].domain, first_name: "Alex" });
console.log(`write_email (${draft.writer}): verdict ${draft.verdict}, ${draft.lint.words} words`);
const res = await client.listResources();
console.log(`resources: ${res.resources.length}`);
await client.close();
resetDb();
// Windows can hold the SQLite file briefly after close; a leftover temp folder is harmless.
try {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
console.log("MCP smoke test passed");
