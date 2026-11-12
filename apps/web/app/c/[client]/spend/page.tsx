import { spendReport, getClient, providerStatus } from "@gtm/core";
import { Figure, PageHead, ModeBadge } from "@/components/ui";

export default async function SpendPage({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  const c = getClient(client);
  const r = spendReport(client);
  const status = providerStatus(c);
  const used = r.budget ? Math.min(1, r.month.credits / r.budget) : 0;
  const maxDay = Math.max(1, ...r.daily.map((d) => d.credits));

  return (
    <>
      <PageHead
        title="Spend"
        lead="Every provider call is logged with its credits and estimated cost. Repeat lookups come from the cache for free, and the monthly budget is a hard cap: calls stop before it is crossed."
      >
        <ModeBadge mode={status.mode} reason={status.reason} />
      </PageHead>

      <div className="figures">
        <Figure value={r.month.credits} label={`Credits this month of ${r.budget}`} />
        <Figure value={`$${r.month.usd.toFixed(2)}`} label="Estimated cost this month" />
        <Figure value={r.remaining} label="Credits left" />
        <Figure value={`${r.cacheHitRate}%`} label="Lookups served from cache" />
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <h2>Budget</h2>
          <p>Change it with: npm run gtm -- budget {client} &lt;credits&gt;</p>
        </div>
        <div style={{ height: 10, background: "var(--sunk)", borderRadius: 5, overflow: "hidden" }} role="meter" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
          <div style={{ width: `${used * 100}%`, height: "100%", background: used > 0.85 ? "var(--bad)" : "var(--signal)" }} />
        </div>
        {r.daily.length ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, marginTop: 18 }} aria-label="Credits per day">
            {r.daily.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.credits} credits`} style={{ flex: 1, background: "var(--ink)", opacity: 0.8, height: `${Math.max(2, (d.credits / maxDay) * 100)}%`, borderRadius: "2px 2px 0 0" }} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="panel" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 22 }}>Provider</th>
                  <th>Action</th>
                  <th className="r">Calls</th>
                  <th className="r">Cached</th>
                  <th className="r">Credits</th>
                  <th className="r" style={{ paddingRight: 22 }}>
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.byProvider.map((p) => (
                  <tr key={p.provider + p.action}>
                    <td style={{ paddingLeft: 22 }}>{p.provider}</td>
                    <td>{p.action}</td>
                    <td className="r num">{p.calls}</td>
                    <td className="r num">{p.cached}</td>
                    <td className="r num">{p.credits}</td>
                    <td className="r num" style={{ paddingRight: 22 }}>
                      ${p.usd.toFixed(3)}
                    </td>
                  </tr>
                ))}
                {!r.byProvider.length ? (
                  <tr>
                    <td colSpan={6} style={{ paddingLeft: 22 }} className="muted">
                      No provider calls yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h2 style={{ marginBottom: 10 }}>Latest calls</h2>
          {r.recent.slice(0, 18).map((x, i) => (
            <div key={i} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <div className="small">
                {String(x.provider)} · {String(x.action)}
                <div className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                  {String(x.meta ?? "")}
                </div>
              </div>
              <span className="small num muted">{Number(x.cached) ? "cached" : `${Number(x.credits)} cr`}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
