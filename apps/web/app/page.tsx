import Link from "next/link";
import { listClients, clientOverview, providerStatus } from "@gtm/core";
import { createClientAction } from "./actions";
import { BrainMark, Flash, ModeBadge } from "@/components/ui";
import { Submit } from "@/components/client-bits";

export default async function Home({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const sp = await searchParams;
  const clients = listClients().map((c) => clientOverview(c.slug));
  const keys = providerStatus();
  return (
    <main className="main" style={{ margin: "0 auto" }}>
      <div className="page-head">
        <div>
          <Link href="/" className="brand" aria-label="GTM Brain home">
            <BrainMark /> GTM Brain
          </Link>
          <h1 style={{ marginTop: 22 }}>Client brains</h1>
          <p>Each client has one brain: who buys, what you sell, what you never say, and every campaign result. Claude Code, Codex, Grok and your team all read the same one.</p>
        </div>
      </div>
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      {clients.length === 0 ? (
        <div className="notice" style={{ marginBottom: 20 }}>
          No clients yet. Add your first client below, then put its closed-won and closed-lost CSV exports in its <code>data/</code> folder.
        </div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 22 }}>Client</th>
                  <th>Brain health</th>
                  <th>ICP</th>
                  <th className="r">Tier 1</th>
                  <th className="r">Accounts</th>
                  <th className="r">Meetings</th>
                  <th className="r">Waiting for owner</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((o) => (
                  <tr key={o.client.slug}>
                    <td style={{ paddingLeft: 22 }}>
                      <Link className="row-link" href={`/c/${o.client.slug}`}>
                        {o.client.name}
                      </Link>
                      <div className="small faint">Owner {o.client.owner}</div>
                    </td>
                    <td>
                      <span className="display num" style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                        {o.health.score}
                      </span>
                      <span className="faint small"> /100</span>
                    </td>
                    <td className="small">{o.icp ? `${o.icp.nWon} wins, ${o.icp.core.length} core traits` : <span className="faint">Not built</span>}</td>
                    <td className="r num">{o.accounts.tiers["Tier 1"] ?? 0}</td>
                    <td className="r num">{o.accounts.total}</td>
                    <td className="r num">{o.campaigns.meetings}</td>
                    <td className="r num">{o.pendingApprovals || <span className="faint">0</span>}</td>
                    <td>
                      <ModeBadge mode={o.providers.mode} reason={o.providers.reason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 18 }}>
        <form className="panel" action={createClientAction}>
          <div className="panel-head">
            <h2>Add a client</h2>
            <p>Creates the brain folder with starter files.</p>
          </div>
          <div className="form-row">
            <label className="field">
              Client name
              <input className="input" name="name" required placeholder="Acme" />
            </label>
            <label className="field">
              Brain owner
              <input className="input" name="owner" required placeholder="The one person who approves changes" />
            </label>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="field">
              Website
              <input className="input" name="website" placeholder="acme.com" />
            </label>
            <label className="field">
              Monthly credit budget
              <input className="input num" name="budget" type="number" min={0} defaultValue={2000} />
            </label>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <Submit pendingText="Creating…">Create client</Submit>
          </div>
        </form>
        <div className="panel">
          <div className="panel-head">
            <h2>Connections</h2>
          </div>
          {[
            ["Claude (writing, chat)", keys.anthropic, "ANTHROPIC_API_KEY", "Until then, emails use the template writer and chat is off."],
            ["ColdIQ (companies, people, emails, signals)", keys.coldiq, "COLDIQ_API_KEY", "Recommended: one key replaces Apollo, Hunter and ZeroBounce."],
            ["Apollo (companies, people, signals)", keys.apollo, "APOLLO_API_KEY", keys.coldiq ? "Not needed while ColdIQ is connected." : "Until then, company and people search is off."],
            ["Hunter (email finder and verifier)", keys.hunter, "HUNTER_API_KEY", keys.coldiq ? "Not needed while ColdIQ is connected." : "Until then, email finding is off."],
            ["ZeroBounce (email verifier)", keys.zerobounce, "ZEROBOUNCE_API_KEY", "Optional if Hunter is set."],
          ].map(([label, on, key, off]) => (
            <div className="check" key={String(key)}>
              <span className={`dot ${on ? "pass" : "warn"}`} />
              <div>
                <div>{label}</div>
                <div className="small faint">{on ? "Connected" : `Add ${key} to .env.local. ${off}`}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
