import { recommend, listCampaigns, listDir, getClient } from "@gtm/core";
import { Flash, PageHead, Empty, pct, fmtDate } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { closeCampaignAction } from "@/app/actions";

export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const c = getClient(client);
  const rec = recommend(client);
  const rows = listCampaigns(client) as Record<string, any>[];
  const csvs = listDir(client, "data").filter((p) => p.endsWith(".csv") && !/closed-(won|lost)|crm-contacts|target-accounts/.test(p));
  const maxRate = Math.max(0.02, ...rec.posteriors.map((p) => p.interval[1]));

  return (
    <>
      <PageHead
        title="Campaigns"
        lead="Every closed campaign is written back to past-campaigns/ and feeds this view. Rates come with honest uncertainty: the bar is the 95% range for the true positive-reply rate, and P(best) is the chance each segment is actually the winner."
      />
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Segments</h2>
              <p>{rec.campaigns} campaign rows</p>
            </div>
            {rec.posteriors.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Segment</th>
                      <th className="r">Positive</th>
                      <th style={{ width: "34%" }}>Positive-reply rate, 95% range</th>
                      <th className="r">P(best)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rec.posteriors.map((p) => (
                      <tr key={p.segment}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.segment}</div>
                          <div className="small faint">
                            {p.replies} replies · {p.meetings} meetings
                          </div>
                        </td>
                        <td className="r num">
                          {p.positive}/{p.sent}
                        </td>
                        <td>
                          <div style={{ position: "relative", height: 16, background: "var(--sunk)", borderRadius: 3 }} title={`${pct(p.interval[0])} to ${pct(p.interval[1])}`}>
                            <div style={{ position: "absolute", top: 5, height: 6, borderRadius: 3, background: "var(--signal-soft)", left: `${(p.interval[0] / maxRate) * 100}%`, width: `${((p.interval[1] - p.interval[0]) / maxRate) * 100}%`, outline: "1px solid var(--signal)" }} />
                            <div style={{ position: "absolute", top: 2, width: 3, height: 12, borderRadius: 2, background: "var(--signal)", left: `calc(${(p.positiveRate / maxRate) * 100}% - 1px)` }} />
                          </div>
                          <div className="small num muted" style={{ marginTop: 2 }}>
                            {pct(p.positiveRate)}
                          </div>
                        </td>
                        <td className="r num display" style={{ fontWeight: 700 }}>
                          {Math.round(p.pBest * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No campaigns closed yet">Close your first campaign with the form on the right. Segment results start here.</Empty>
            )}
          </div>
          {rec.angles.length > 1 ? (
            <div className="panel">
              <h2 style={{ marginBottom: 10 }}>Angles</h2>
              {rec.angles.map((p) => (
                <div key={p.segment} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                  <span>{p.segment}</span>
                  <span className="num small muted">
                    {p.positive}/{p.sent} · {pct(p.positiveRate)}
                  </span>
                  <span className="num small" style={{ width: 70, textAlign: "right" }}>
                    {Math.round(p.pBest * 100)}% best
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="panel">
            <h2 style={{ marginBottom: 10 }}>Closed</h2>
            {rows.length ? (
              rows.slice(0, 30).map((r) => (
                <div key={r.id} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div className="small faint">
                      {r.segment}
                      {r.angle ? ` · ${r.angle}` : ""} · {fmtDate(r.closed_at)}
                    </div>
                  </div>
                  <span className="num small muted">
                    {r.positive}/{r.sent} positive · {r.meetings} mtgs
                  </span>
                </div>
              ))
            ) : (
              <p className="small muted">Nothing closed yet.</p>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <h2 style={{ marginBottom: 10 }}>Run next</h2>
            {rec.recommendations.length ? (
              rec.recommendations.slice(0, 5).map((r) => (
                <div key={r.segment + r.action} className="check" style={{ gridTemplateColumns: "92px minmax(0,1fr)" }}>
                  <span className={`pill ${r.action === "scale" ? "good" : r.action === "stop" ? "bad" : r.action === "explore" ? "signal" : "warn"}`}>{r.action}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.segment}</div>
                    <div className="small muted">{r.why}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="small muted">Recommendations appear after the first closed campaign.</p>
            )}
          </div>

          <form className="panel" action={closeCampaignAction.bind(null, client)}>
            <div className="panel-head">
              <h2>Close a campaign</h2>
              <p>Writes past-campaigns/ and proposes ICP learnings to {c.owner}.</p>
            </div>
            <div className="form-row">
              <label className="field">
                Campaign name
                <input className="input" name="name" required placeholder="November SDR hiring" />
              </label>
              <label className="field">
                Angle
                <input className="input" name="angle" placeholder="SDR hiring" />
              </label>
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              Per-recipient export (optional)
              <select className="select" name="results_csv" defaultValue="">
                <option value="">None, I'll enter totals</option>
                {csvs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row" style={{ marginTop: 12 }}>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Segment (for totals)
                <input className="input" name="segment" placeholder="B2B SaaS · 51-200" />
              </label>
              {(["sent", "replies", "positive", "meetings"] as const).map((k) => (
                <label key={k} className="field">
                  {k[0].toUpperCase() + k.slice(1)}
                  <input className="input num" name={k} type="number" min={0} />
                </label>
              ))}
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              First email
              <textarea className="textarea" name="first_email" style={{ minHeight: 90, fontFamily: "var(--body)" }} />
            </label>
            <label className="field" style={{ marginTop: 12 }}>
              Your name
              <input className="input" name="as" placeholder="Shown as the author" />
            </label>
            <div className="actions" style={{ marginTop: 14 }}>
              <Submit pendingText="Closing…">Close campaign</Submit>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
