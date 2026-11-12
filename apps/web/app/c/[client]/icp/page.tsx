import { loadIcpModel, getClient, crmStats, DIMENSION_LABELS, icpQuery } from "@gtm/core";
import { Flash, PageHead, Empty, fmtDate, pct } from "@/components/ui";
import { LiftChart } from "@/components/lift-chart";
import { Submit } from "@/components/client-bits";
import { buildIcpAction, importCrmAction } from "@/app/actions";

export default async function IcpPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const c = getClient(client);
  const model = loadIcpModel(client);
  const crm = crmStats(client);
  const query = model ? icpQuery(model) : null;

  return (
    <>
      <PageHead
        title="Ideal customer profile"
        lead="Built from your won and lost deals, not opinions. Lift compares how often a trait shows up in wins against losses; confidence comes from a two-proportion z-test, so a pattern seen in three deals cannot pass as a rule."
      >
        <form action={importCrmAction.bind(null, client, `/c/${client}/icp`)}>
          <Submit className="btn" pendingText="Importing…">
            Re-import CRM files
          </Submit>
        </form>
        <form action={buildIcpAction.bind(null, client)} className="actions">
          <Submit pendingText="Building…" name="apply" value="0">
            Rebuild as proposal
          </Submit>
        </form>
      </PageHead>
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      {!model ? (
        <div className="panel">
          <Empty title={crm.won ? "Ready to build" : "No deals imported yet"}>
            {crm.won
              ? `${crm.won} won and ${crm.lost} lost deals are imported. Build the ICP to see which traits separate them.`
              : `Save closed-won.csv and closed-lost.csv in workspaces/${client}/data/ with columns company, domain, industry, employees, region, tech (separated by ;), signer_title, deal_value, closed_at. Then import.`}
          </Empty>
        </div>
      ) : (
        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <h2>Lift by trait</h2>
              <p>
                {model.nWon} wins, {model.nLost} losses, baseline win rate {pct(model.baselineWinRate, 0)}. Built {fmtDate(model.builtAt)}.
              </p>
            </div>
            <LiftChart traits={model.traits} nWon={model.nWon} nLost={model.nLost} />
          </div>
          <div className="stack">
            <div className="panel">
              <h2 style={{ marginBottom: 10 }}>The profile, in one search</h2>
              <p className="small muted" style={{ marginBottom: 10 }}>
                This is the search Prospect runs against your data provider.
              </p>
              {query &&
                (
                  [
                    ["Industries", query.industries],
                    ["Company size", query.employeeRanges.map((r) => r.replace(",", "–"))],
                    ["Locations", query.locations],
                    ["Tools", query.technologies],
                  ] as [string, string[]][]
                ).map(([label, vals]) => (
                  <div key={label} className="check" style={{ gridTemplateColumns: "110px 1fr" }}>
                    <span className="muted small">{label}</span>
                    <div className="actions">{vals.length ? vals.map((v) => <span key={v} className="pill">{v}</span>) : <span className="faint small">any</span>}</div>
                  </div>
                ))}
            </div>
            <div className="panel">
              <h2 style={{ marginBottom: 10 }}>Avoid</h2>
              {model.traits.filter((t) => t.verdict === "negative").length ? (
                model.traits
                  .filter((t) => t.verdict === "negative")
                  .sort((a, b) => a.lift - b.lift)
                  .map((t) => (
                    <div key={t.dimension + t.value} className="check" style={{ gridTemplateColumns: "1fr auto" }}>
                      <div>
                        <div>{t.value}</div>
                        <div className="small faint">{DIMENSION_LABELS[t.dimension]}</div>
                      </div>
                      <span className="num small" style={{ color: "var(--bad)", fontWeight: 600 }}>
                        {t.won}W · {t.lost}L
                      </span>
                    </div>
                  ))
              ) : (
                <p className="small muted">Nothing is clearly over-represented in losses yet.</p>
              )}
            </div>
            {model.warnings.length ? (
              <div className="notice warn">
                {model.warnings.map((w) => (
                  <div key={w}>{w}</div>
                ))}
              </div>
            ) : null}
            <p className="small faint">
              Rebuilding files a proposal; {c.owner} approves it before icp.md changes.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
