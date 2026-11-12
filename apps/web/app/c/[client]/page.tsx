import Link from "next/link";
import { clientOverview, listAccounts, recommend, loadIcpModel, brainHealth } from "@gtm/core";
import { Figure, Flash, PageHead, Meter, Empty, pct } from "@/components/ui";
import { LiftChart } from "@/components/lift-chart";
import { importCrmAction } from "@/app/actions";
import { Submit } from "@/components/client-bits";

export default async function Overview({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const o = clientOverview(client);
  const model = loadIcpModel(client);
  const top = listAccounts(client, { tier: "Tier 1", limit: 6 });
  const rec = recommend(client);
  const health = brainHealth(client);
  const replyRate = o.campaigns.sent ? o.campaigns.positive / o.campaigns.sent : 0;

  return (
    <>
      <PageHead title={o.client.name} lead={`What ${o.client.name}'s brain knows today, and what to do next. Every agent connected to it reads the same files.`}>
        <Link className="btn" href={`/c/${client}/chat`}>
          Ask the brain
        </Link>
      </PageHead>
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      <div className="figures">
        <Figure value={`${o.health.score}`} label={`Brain health (${o.health.grade})`} />
        <Figure value={o.accounts.tiers["Tier 1"] ?? 0} label="Tier 1 accounts" />
        <Figure value={o.contacts.verified} label="Verified contacts" />
        <Figure value={o.campaigns.meetings} label={`Meetings from ${o.campaigns.count} campaigns`} />
        <Figure value={o.campaigns.sent ? pct(replyRate) : "–"} label="Positive reply rate" />
      </div>

      {!o.crm.won ? (
        <div className="panel">
          <Empty title="Start with your CRM">
            Export closed-won and closed-lost deals as CSV and save them as data/closed-won.csv and data/closed-lost.csv in workspaces/{client}/. Optional: data/crm-contacts.csv
            (customers, open deals, do-not-contact) and data/target-accounts.csv.
          </Empty>
          <form action={importCrmAction.bind(null, client, `/c/${client}`)}>
            <Submit pendingText="Importing…">Import CRM files</Submit>
          </form>
        </div>
      ) : (
        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>Who buys, and who doesn't</h2>
              <Link href={`/c/${client}/icp`} className="small muted">
                Full ICP
              </Link>
            </div>
            {model ? (
              <>
                <p className="small muted" style={{ marginBottom: 6 }}>
                  From {model.nWon} won and {model.nLost} lost deals. Strongest traits per dimension; faded bars have less evidence.
                </p>
                <LiftChart traits={model.traits} nWon={model.nWon} nLost={model.nLost} limitPerDim={3} />
              </>
            ) : (
              <Empty title="ICP not built yet" href={`/c/${client}/icp`} cta="Build the ICP" />
            )}
          </div>
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <h2>Work these first</h2>
                <Link href={`/c/${client}/accounts`} className="small muted">
                  All accounts
                </Link>
              </div>
              {top.length ? (
                top.map((a) => (
                  <div key={a.domain} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                    <div>
                      <Link className="row-link" href={`/c/${client}/accounts/${a.domain}`}>
                        {a.name}
                      </Link>
                      <div className="small muted">{a.signals[0]?.title ?? a.reasons.find((r) => r.startsWith("+")) ?? ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className="display num" style={{ fontWeight: 700 }}>
                        {a.score}
                      </span>
                      <Meter fit={a.fit} intent={a.intent} />
                    </div>
                  </div>
                ))
              ) : (
                <Empty title="No Tier 1 accounts yet" href={`/c/${client}/accounts`} cta="Find and score accounts" />
              )}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Run next</h2>
                <Link href={`/c/${client}/campaigns`} className="small muted">
                  Campaigns
                </Link>
              </div>
              {rec.recommendations.length ? (
                rec.recommendations.slice(0, 3).map((r) => (
                  <div key={r.segment} className="check" style={{ gridTemplateColumns: "92px minmax(0,1fr)" }}>
                    <span className={`pill ${r.action === "scale" ? "good" : r.action === "stop" ? "bad" : r.action === "explore" ? "signal" : "warn"}`}>{r.action}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.segment}</div>
                      <div className="small muted">{r.why}</div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted small">Close a campaign to start learning which segments win.</p>
              )}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Brain health</h2>
                <Link href={`/c/${client}/brain`} className="small muted">
                  Files
                </Link>
              </div>
              {health.checks
                .filter((c) => c.status !== "pass")
                .slice(0, 4)
                .map((c) => (
                  <div className="check" key={c.id}>
                    <span className={`dot ${c.status}`} />
                    <div>
                      <div>{c.label}</div>
                      <div className="small muted">{c.fix ?? c.detail}</div>
                    </div>
                  </div>
                ))}
              {health.checks.every((c) => c.status === "pass") ? <p className="small muted">Every check passes. Agents have what they need.</p> : null}
              {o.pendingApprovals ? (
                <Link href={`/c/${client}/approvals`} className="notice" style={{ display: "block", marginTop: 12, textDecoration: "none" }}>
                  {o.pendingApprovals} change{o.pendingApprovals > 1 ? "s" : ""} waiting for {o.client.owner}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
