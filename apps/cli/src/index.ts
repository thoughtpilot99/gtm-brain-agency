import os from "node:os";
import {
  TOOLS,
  runTool,
  createClient,
  updateClient,
  getClient,
  GtmError,
  type ToolContext,
} from "@gtm/core";

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const HELP = `${c.bold("gtm")}: GTM Brain command line

${c.bold("Clients")}
  gtm clients                                  list client brains
  gtm init "<name>" --owner "<owner>" [--budget 2000] [--website x.com]
  gtm overview <client>                        health, ICP, tiers, spend at a glance
  gtm owner <client> "<name>"                  change the brain owner
  gtm budget <client> <credits>                monthly credit cap

${c.bold("Build the brain")}
  gtm import-crm <client>                      import data/*.csv from the client's folder
  gtm build-icp <client> [--apply]             ICP from won/lost deals (owner can --apply)
  gtm health <client>                          brain health score and fixes

${c.bold("Accounts and contacts")}
  gtm prospect <client> [--limit 25]           find companies that match the ICP
  gtm signals <client> <domain>                buying signals for one account
  gtm score <client> [--refresh] [--one-batch] score and tier accounts (batches of 100)
  gtm top <client> [--tier "Tier 1"] [--limit 20]
  gtm people <client> <domain> [--titles "VP Sales,Head of RevOps"]
  gtm email <client> <domain> <first> <last>   email waterfall: find + verify

${c.bold("Copy")}
  gtm write <client> <domain> [--first Maya] [--last Lee] [--title "VP Sales"] [--angle "..."]
  gtm lint <client> "<text>"

${c.bold("Learning loop")}
  gtm close-campaign <client> --name "..." (--csv data/results.csv | --sent N --replies N --positive N --meetings N --segment "...") [--angle "..."]
  gtm recommend <client>

${c.bold("Approvals (one owner)")}
  gtm proposals <client> [--all]
  gtm approve <client> <id> --as "<owner>"
  gtm reject <client> <id> --as "<owner>"

${c.bold("Other")}
  gtm spend <client>                           credits and $ this month
  gtm tools                                    list every tool
  gtm tool <name> '<json input>'               run any tool directly
  Add --json to any command for raw output. --as "<name>" sets who you are (default: your OS user).
`;

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, ...args] = pos;
  const asJson = !!flags.json;
  const ctx: ToolContext = { actor: String(flags.as ?? process.env.GTM_ACTOR ?? os.userInfo().username), human: true };

  const call = async (name: string, input: Record<string, unknown>) => {
    const r = await runTool(name, input, ctx);
    if (!r.ok) throw new GtmError(r.error, r.code);
    return r.result as Record<string, any>;
  };
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const need = (v: string | undefined, what: string) => {
    if (!v) throw new GtmError(`Missing ${what}. Run gtm help.`);
    return v;
  };
  const num = (k: string) => (flags[k] !== undefined ? Number(flags[k]) : undefined);

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return;
    case "clients": {
      const r = (await call("list_clients", {})) as unknown as { slug: string; name: string; owner: string; demo: boolean }[];
      if (asJson) return out(r);
      if (!r.length) return console.log('No clients yet. Run: gtm init "Acme" --owner "Your Name"');
      for (const x of r) console.log(`${c.bold(x.slug.padEnd(16))} ${x.name.padEnd(24)} owner: ${x.owner}${x.demo ? c.dim("  (sample data)") : ""}`);
      return;
    }
    case "init": {
      const name = need(args[0], "client name");
      const owner = need(flags.owner as string, "--owner");
      const cl = createClient({ name, owner, website: flags.website as string | undefined, creditBudget: num("budget"), slug: flags.slug as string | undefined });
      if (asJson) return out(cl);
      console.log(`${c.green("Created")} workspaces/${cl.slug}/ (owner: ${cl.owner}, budget ${cl.creditBudget} credits/month)`);
      console.log(`Next: put closed-won.csv and closed-lost.csv in workspaces/${cl.slug}/data/, then: gtm import-crm ${cl.slug} && gtm build-icp ${cl.slug}`);
      return;
    }
    case "owner": {
      const cl = updateClient(need(args[0], "client"), { owner: need(args[1], "owner name") });
      return console.log(`Owner of ${cl.slug} is now ${cl.owner}`);
    }
    case "budget": {
      const cl = updateClient(need(args[0], "client"), { creditBudget: Number(need(args[1], "credits")) });
      return console.log(`Monthly budget for ${cl.slug}: ${cl.creditBudget} credits`);
    }
    case "overview": {
      const r = await call("client_overview", { client: need(args[0], "client") });
      if (asJson) return out(r);
      console.log(`${c.bold(r.client.name)}  owner ${r.client.owner}  ${r.providers.mode === "live" ? c.green("live data") : r.providers.mode === "off" ? c.yellow("no data key") : c.yellow("sample data")} ${c.dim(`(${r.providers.reason})`)}`);
      console.log(`Brain health  ${r.health.score}/100 (${r.health.grade})`);
      for (const f of r.health.failing) console.log(c.dim(`  · ${f.label}${f.fix ? `: ${f.fix}` : ""}`));
      console.log(`CRM           ${r.crm.won} won, ${r.crm.lost} lost, ${r.crm.contacts} contacts`);
      console.log(`ICP           ${r.icp ? r.icp.core.join(" | ") : "not built"}`);
      console.log(`Accounts      ${r.accounts.total} ${JSON.stringify(r.accounts.tiers)}`);
      console.log(`Contacts      ${r.contacts.total} (${r.contacts.verified} verified emails)`);
      console.log(`Campaigns     ${r.campaigns.count} closed, ${r.campaigns.sent} sent, ${r.campaigns.positive} positive, ${r.campaigns.meetings} meetings`);
      console.log(`Approvals     ${r.pendingApprovals} pending`);
      console.log(`Spend         ${r.spend.credits} credits, $${r.spend.usd.toFixed(2)} this month`);
      return;
    }
    case "import-crm": {
      const r = await call("import_crm", { client: need(args[0], "client") });
      if (asJson) return out(r);
      console.log(`Imported ${r.won} won, ${r.lost} lost, ${r.contacts} CRM contacts, ${r.targets} target accounts`);
      if (r.missing.length) console.log(c.yellow(`Missing: ${r.missing.join(", ")}`));
      if (r.skipped.length) console.log(c.dim(`Skipped ${r.skipped.length} rows: ${r.skipped.slice(0, 3).join("; ")}`));
      return;
    }
    case "build-icp": {
      const r = await call("build_icp", { client: need(args[0], "client"), apply: !!flags.apply });
      if (asJson) return out(r);
      console.log(`ICP from ${r.wins} wins and ${r.losses} losses${r.summaryBy === "claude" ? " (summary by Claude)" : ""}`);
      console.log(c.bold("Core traits"));
      for (const t of r.core) console.log(`  ${t.dimension.padEnd(18)} ${String(t.value).padEnd(24)} lift ${String(t.lift).padStart(5)}x  ${t.wins}W/${t.losses}L  ${t.confidence}`);
      if (r.avoid.length) console.log(c.bold("Avoid"), r.avoid.map((t: any) => `${t.value} (${t.lift}x)`).join(", "));
      for (const w of r.warnings) console.log(c.yellow(`! ${w}`));
      if (r.applied) console.log(c.green("icp.md updated."));
      else if (r.proposalId) console.log(`Filed as proposal #${r.proposalId}. Owner approves with: gtm approve ${args[0]} ${r.proposalId} --as "<owner>"`);
      else console.log("icp.md already matches.");
      if (r.note) console.log(c.dim(r.note));
      return;
    }
    case "health": {
      const r = await call("brain_health", { client: need(args[0], "client") });
      if (asJson) return out(r);
      console.log(`${c.bold(`Brain health ${r.score}/100 (${r.grade})`)}`);
      for (const ch of r.checks) {
        const icon = ch.status === "pass" ? c.green("✓") : ch.status === "warn" ? c.yellow("!") : c.red("✗");
        console.log(`${icon} ${ch.label}: ${ch.detail}${ch.fix ? c.dim(`\n    fix: ${ch.fix}`) : ""}`);
      }
      return;
    }
    case "prospect": {
      const r = await call("prospect_from_icp", { client: need(args[0], "client"), limit: num("limit") });
      if (asJson) return out(r);
      console.log(`${r.found} companies (${r.mode} data)${r.relaxedTechFilter ? c.dim(" - tool filter relaxed") : ""}`);
      for (const x of r.companies) console.log(`  ${x.name.padEnd(26)} ${x.domain.padEnd(26)} ${String(x.industry ?? "").padEnd(18)} ${String(x.employees ?? "").padStart(5)}${x.suppressed ? c.red(`  ${x.suppressed}`) : ""}`);
      return;
    }
    case "signals": {
      const r = await call("find_signals", { client: need(args[0], "client"), domain: need(args[1], "domain") });
      if (asJson) return out(r);
      console.log(`${r.company ?? args[1]}: ${r.signals.length} signals (${r.added} new, ${r.mode} data)`);
      for (const s of r.signals) console.log(`  ${s.date.slice(0, 10)}  ${s.type.padEnd(18)} ${s.title}${s.url ? c.dim(` ${s.url}`) : ""}`);
      return;
    }
    case "score": {
      const r = await call("score_accounts", { client: need(args[0], "client"), refresh_signals: !!flags.refresh, one_batch: !!flags["one-batch"] });
      if (asJson) return out(r);
      console.log(`Scored ${r.progress.done}/${r.progress.total} (${r.progress.status})  ${JSON.stringify(r.tiers)}`);
      if (!r.usedIcp) console.log(c.yellow("No ICP yet: fit is 0. Run gtm build-icp first."));
      for (const a of r.top) console.log(`  ${String(a.score).padStart(5)}  ${a.tier.padEnd(7)} ${a.name.padEnd(26)} ${c.dim(a.why.slice(0, 2).join(" · "))}`);
      if (r.progress.status === "paused") console.log(`Check this batch, then run: gtm score ${args[0]}${flags.refresh ? " --refresh" : ""}  (resumes)`);
      for (const e of r.errors) console.log(c.yellow(`  ${e}`));
      return;
    }
    case "top": {
      const r = (await call("top_accounts", { client: need(args[0], "client"), tier: flags.tier, limit: num("limit") })) as unknown as any[];
      if (asJson) return out(r);
      for (const a of r) {
        console.log(`${c.bold(String(a.score).padStart(5))}  ${String(a.tier).padEnd(7)} ${a.name} ${c.dim(a.domain)}  fit ${a.fit} · intent ${a.intent}`);
        for (const why of a.reasons.slice(0, 5)) console.log(c.dim(`         ${why}`));
      }
      return;
    }
    case "people": {
      const titles = typeof flags.titles === "string" ? flags.titles.split(",").map((s) => s.trim()) : undefined;
      const r = await call("find_people", { client: need(args[0], "client"), domain: need(args[1], "domain"), titles });
      if (asJson) return out(r);
      for (const p of r.people) console.log(`  ${p.name.padEnd(22)} ${p.title.padEnd(34)} ${c.dim(p.id)}${p.suppressed ? c.red(`  ${p.suppressed}`) : ""}`);
      return;
    }
    case "email": {
      const r = await call("enrich_contact", { client: need(args[0], "client"), domain: need(args[1], "domain"), first_name: need(args[2], "first name"), last_name: need(args[3], "last name") });
      if (asJson) return out(r);
      const col = r.status === "verified" ? c.green : r.status === "invalid" || r.status === "not_found" ? c.red : c.yellow;
      console.log(`${r.email ?? "no email"}  ${col(r.status)}${r.suppressed ? c.red(`  suppressed: ${r.suppressed}`) : ""}`);
      for (const s of r.steps) console.log(c.dim(`  ${s.provider.padEnd(11)} ${s.action.padEnd(13)} ${s.outcome}${s.cached ? " (cached)" : s.credits ? ` (${s.credits} cr)` : ""}`));
      return;
    }
    case "write": {
      const r = await call("write_email", { client: need(args[0], "client"), domain: need(args[1], "domain"), first_name: flags.first, last_name: flags.last, title: flags.title, angle: flags.angle });
      if (asJson) return out(r);
      const col = r.verdict === "ready" ? c.green : r.verdict === "blocked" ? c.red : c.yellow;
      console.log(`${c.bold("Subject:")} ${r.subject}\n\n${r.body}\n`);
      console.log(`${col(r.verdict.toUpperCase())}  ${r.lint.words} words  written by ${r.writer}`);
      console.log(c.bold("Claim ledger"));
      for (const cl of r.claims) console.log(`  ${cl.supported ? c.green("✓") : c.red("✗")} [${cl.sources.join(",") || "-"}] ${cl.sentence}${cl.problems.length ? c.red(`\n      ${cl.problems.join("; ")}`) : ""}`);
      for (const i of r.lint.issues) console.log(`  ${i.severity === "error" ? c.red("error") : c.yellow("warn ")} ${i.message}`);
      console.log(c.dim("Sources: " + r.sources.map((s: any) => `[${s.id}] ${s.text.slice(0, 60)}`).join("  ")));
      return;
    }
    case "lint": {
      const r = await call("lint_copy", { client: need(args[0], "client"), text: need(args.slice(1).join(" "), "text") });
      if (asJson) return out(r);
      console.log(`${r.ok ? c.green("OK") : c.red("FAILS")}  ${r.words} words`);
      for (const i of r.issues) console.log(`  ${i.severity === "error" ? c.red("error") : c.yellow("warn ")} ${i.message}`);
      return;
    }
    case "close-campaign": {
      const r = await call("close_campaign", {
        client: need(args[0], "client"),
        name: need(flags.name as string, "--name"),
        results_csv: flags.csv,
        segment: flags.segment,
        angle: flags.angle,
        sent: num("sent"),
        replies: num("replies"),
        positive: num("positive"),
        meetings: num("meetings"),
        first_email: flags["first-email"],
        notes: flags.notes,
      });
      if (asJson) return out(r);
      console.log(`Wrote ${r.file}: ${r.totals.sent} sent, ${r.totals.replies} replies, ${r.totals.positive} positive, ${r.totals.meetings} meetings`);
      for (const rec of r.recommendations) console.log(`  ${rec.action.toUpperCase().padEnd(9)} ${rec.segment}: ${c.dim(rec.why)}`);
      if (r.proposal) console.log(`ICP learnings filed as proposal #${r.proposal.id} for the owner.`);
      return;
    }
    case "recommend": {
      const r = await call("recommend_segments", { client: need(args[0], "client") });
      if (asJson) return out(r);
      console.log(c.bold("Segments (Bayesian, positive-reply rate)"));
      for (const p of r.posteriors) console.log(`  ${p.segment.padEnd(34)} ${String(p.positive).padStart(4)}/${String(p.sent).padEnd(5)} ${(p.positiveRate * 100).toFixed(1).padStart(5)}%  P(best) ${(p.pBest * 100).toFixed(0)}%`);
      console.log(c.bold("Next"));
      for (const rec of r.recommendations.slice(0, 5)) console.log(`  ${rec.action.toUpperCase().padEnd(9)} ${rec.segment}: ${c.dim(rec.why)}`);
      return;
    }
    case "proposals": {
      const r = (await call("list_proposals", { client: need(args[0], "client"), status: flags.all ? "all" : "pending" })) as unknown as any[];
      if (asJson) return out(r);
      if (!r.length) return console.log("No pending proposals.");
      const owner = getClient(args[0]).owner;
      for (const p of r) {
        console.log(`${c.bold(`#${p.id}`)} ${p.path}  ${c.green(`+${p.added}`)} ${c.red(`-${p.removed}`)}  by ${p.author}  ${c.dim(p.status)}\n  ${p.reason}`);
        for (const d of p.diff.slice(0, 12)) console.log(`    ${d.startsWith("+") ? c.green(d) : c.red(d)}`);
      }
      console.log(c.dim(`Owner ${owner} approves with: gtm approve ${args[0]} <id> --as "${owner}"`));
      return;
    }
    case "approve":
    case "reject": {
      const r = await call("decide_proposal", { client: need(args[0], "client"), id: Number(need(args[1], "proposal id")), approve: cmd === "approve", approver: need(flags.as as string, '--as "<owner>"') });
      if (asJson) return out(r);
      return console.log(`#${r.id} ${r.path}: ${r.status} by ${r.decidedBy}`);
    }
    case "spend": {
      const r = await call("spend_report", { client: need(args[0], "client") });
      if (asJson) return out(r);
      console.log(`This month: ${r.month.credits} credits ($${r.month.usd.toFixed(2)}) of ${r.budget}. Remaining ${r.remaining}. Cache hit rate ${r.cacheHitRate}%.`);
      for (const p of r.byProvider) console.log(`  ${p.provider.padEnd(11)} ${p.action.padEnd(16)} ${String(p.calls).padStart(5)} calls  ${String(p.cached).padStart(4)} cached  ${String(p.credits).padStart(6)} cr  $${p.usd.toFixed(3)}`);
      return;
    }
    case "tools":
      for (const t of TOOLS) console.log(`${c.bold(t.name.padEnd(22))} ${t.description}`);
      return;
    case "tool": {
      const name = need(args[0], "tool name");
      let input: unknown = {};
      if (args[1]) {
        try {
          input = JSON.parse(args[1]);
        } catch {
          throw new GtmError("Tool input must be JSON, e.g. '{\"client\":\"acme\"}'");
        }
      }
      return out(await call(name, input as Record<string, unknown>));
    }
    default:
      console.log(c.red(`Unknown command "${cmd}".`));
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(c.red(`Error: ${e instanceof Error ? e.message : String(e)}`));
  process.exitCode = 1;
});
