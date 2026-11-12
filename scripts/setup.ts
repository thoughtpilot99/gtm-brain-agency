/**
 * One-time setup: creates .env.local from .env.example and syncs skills.
 * It loads no sample data: the app starts with no clients until you add your own.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, providerStatus, listClients } from "../packages/core/src/index";
import { syncSkills } from "./sync-skills";

const envLocal = path.join(ROOT, ".env.local");
if (!fs.existsSync(envLocal)) {
  fs.copyFileSync(path.join(ROOT, ".env.example"), envLocal);
  console.log("Created .env.local. Add your API keys there (never inside workspaces/).");
}

const skills = syncSkills();
console.log(`Skills synced to .claude/skills and .agents/skills: ${skills.join(", ")}`);

const ps = providerStatus();
console.log(`\nKeys found: Anthropic ${ps.anthropic ? "yes" : "no"} · Apollo ${ps.apollo ? "yes" : "no"} · Hunter ${ps.hunter ? "yes" : "no"} · ZeroBounce ${ps.zerobounce ? "yes" : "no"}`);
console.log(`Clients: ${listClients().length}`);
console.log('\nNext:\n  npm run dev                                   open http://localhost:3000 and add your first client\n  npm run gtm -- init "Acme" --owner "Your Name"   or add one from the CLI\n  claude                                        open Claude Code here; the gtm-brain MCP server is in .mcp.json');
