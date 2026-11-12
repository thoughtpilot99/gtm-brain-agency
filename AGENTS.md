# GTM Brain

This repo is a GTM brain for many clients. Claude Code, Codex and Grok Build all read this file.
Each client has its own brain folder at `workspaces/<client>/` with `icp.md`, `offers.md`, `rules.md`, `products/`, `past-campaigns/`, `call-notes/` and `data/`.
The `gtm-brain` MCP server (in `.mcp.json`) gives you tools that read and act on those brains with live data.

## Before any GTM task
1. Call `list_clients`, then `client_overview` for the client you are working on. Ask which client if it is unclear.
2. Call `read_brain` for `icp.md`, `offers.md` and `rules.md`. Check `past-campaigns/` for what worked with this audience.
3. Use the files in `products/` for every product fact.

## Rules for every agent
- Never invent a fact, a number, a name or a quote. Write "not found".
- Never use a claim or word that the client's `rules.md` bans. Check copy with `lint_copy`.
- `write_email` checks every sentence against numbered sources. Never send or hand over a draft whose verdict is `blocked`.
- Keep every campaign in draft until a person approves it. Ask before you send anything to a sequencer.
- `icp.md`, `offers.md`, `rules.md`, `AGENTS.md` and `products/` change only through `propose_brain_change`. Only the client's brain owner approves them, in the web app (Approvals) or with `gtm approve`. Agents cannot approve. Do not edit those files directly.
- Work in batches of 100 rows. Use `score_accounts` with `one_batch: true` and let a person check the batch before the next one.
- Keep every file inside the client's brain folder. Never put API keys or passwords in `workspaces/`.
- After a campaign, run `close_campaign` so the result is written back into the brain.

## Skills
Repeatable jobs live in `skills/<name>/SKILL.md` and are copied into `.claude/skills` (Claude Code, Grok Build) and `.agents/skills` (Codex) by `npm run sync-skills`.
Run one with `/name` in Claude Code or Grok Build, or `$name` in Codex.

## Working on the code
- Monorepo: `packages/core` (all logic, no UI), `apps/mcp` (MCP server), `apps/cli` (`gtm` CLI), `apps/web` (Next.js dashboard).
- Every capability is a tool in `packages/core/src/tools/registry.ts`. The MCP server, the CLI and the web chat all use that registry, so add new capabilities there.
- `npm run verify` runs typecheck, tests and the MCP smoke test. Keep it passing.
