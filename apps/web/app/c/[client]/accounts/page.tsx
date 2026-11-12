import Link from "next/link";
import { listAccounts, loadIcpModel, TIER_THRESHOLDS } from "@gtm/core";
import { Flash, PageHead, TierBadge, Meter, Empty } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { prospectAction, scoreAction } from "@/app/actions";

const TIERS = ["Tier 1", "Tier 2", "Tier 3", "Suppressed"];

export default async function AccountsPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string; tier?: string; q?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const all = listAccounts(client, { includeSuppressed: true, limit: 5000 });
  const counts = Object.fromEntries(TIERS.map((t) => [t, all.filter((a) => a.tier === t).length]));
  const unscored = all.filter((a) => !a.tier).length;
  const q = (sp.q ?? "").toLowerCase();
  const rows = all
    .filter((a) => (sp.tier ? a.tier === sp.tier : a.tier !== "Suppressed"))
    .filter((a) => !q || `${a.name} ${a.domain} ${a.industry}`.toLowerCase().includes(q))
    .slice(0, 300);
  const hasIcp = !!loadIcpModel(client);

  return (
    <>
      <PageHead
        title="Accounts"
        lead={`Score = ICP fit (up to 60) + buying signals (up to 40, fading with age). Tier 1 is ${TIER_THRESHOLDS.tier1}+, Tier 2 is ${TIER_THRESHOLDS.tier2}+. Customers, open deals and do-not-contact accounts are suppressed automatically.`}
      >
        <form action={prospectAction.bind(null, client)} className="actions">
          <input type="hidden" name="limit" value="25" />
          <Submit className="btn" pendingText="Searching…">
            Find 25 ICP matches
          </Submit>
        </form>
        <form action={scoreAction.bind(null, client)} className="actions">
          <input type="hidden" name="refresh" value="1" />
          <input type="hidden" name="one_batch" value="1" />
          <Submit pendingText="Scoring the first 100…">Refresh signals and score</Submit>
        </form>
      </PageHead>
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />
      {!hasIcp ? <div className="notice warn" style={{ marginBottom: 16 }}>No ICP yet, so fit scores are 0. Build the ICP first.</div> : null}

      <div className="actions" style={{ marginBottom: 14 }}>
        <Link className={`pill ${!sp.tier ? "signal" : ""}`} href={`/c/${client}/accounts`}>
          All active <span className="num">{all.length - counts["Suppressed"]}</span>
        </Link>
        {TIERS.map((t) => (
          <Link key={t} className={`pill ${sp.tier === t ? "signal" : ""}`} href={`/c/${client}/accounts?tier=${encodeURIComponent(t)}`}>
            {t} <span className="num">{counts[t]}</span>
          </Link>
        ))}
        {unscored ? <span className="pill">Unscored {unscored}</span> : null}
        <form style={{ marginLeft: "auto" }}>
          {sp.tier ? <input type="hidden" name="tier" value={sp.tier} /> : null}
          <input className="input" name="q" defaultValue={sp.q} placeholder="Search accounts" aria-label="Search accounts" style={{ width: 220 }} />
        </form>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <div style={{ padding: "0 22px" }}>
            <Empty title="No accounts here">Import data/target-accounts.csv on the Overview page, or find ICP matches with the button above.</Empty>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 22 }}>Account</th>
                  <th>Tier</th>
                  <th className="r">Score</th>
                  <th>Fit · intent</th>
                  <th>Why</th>
                  <th>Strongest signal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.domain}>
                    <td style={{ paddingLeft: 22, minWidth: 190 }}>
                      <Link className="row-link" href={`/c/${client}/accounts/${a.domain}`}>
                        {a.name}
                      </Link>
                      <div className="small faint">
                        {[a.industry, a.employees ? `${a.employees} people` : null, a.region].filter(Boolean).join(", ")}
                      </div>
                    </td>
                    <td>
                      <TierBadge tier={a.tier} />
                    </td>
                    <td className="r num display" style={{ fontWeight: 700 }}>
                      {a.score ?? "–"}
                    </td>
                    <td>
                      <Meter fit={a.fit} intent={a.intent} />
                      <div className="small faint num" style={{ marginTop: 4 }}>
                        {a.fit ?? 0} · {a.intent ?? 0}
                      </div>
                    </td>
                    <td className="small muted" style={{ maxWidth: 320 }}>
                      {a.suppressed ? <span style={{ color: "var(--bad)" }}>{a.suppressed}</span> : a.reasons.filter((r) => r.startsWith("+")).slice(0, 2).map((r) => <div key={r}>{r.slice(2)}</div>)}
                    </td>
                    <td className="small" style={{ maxWidth: 240 }}>
                      {a.signals[0] ? a.signals[0].title : <span className="faint">None found</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="small faint" style={{ marginTop: 12 }}>
        Refresh signals and score runs the first 100 accounts, then stops so you can check them. Press it again to continue where it left off.
      </p>
    </>
  );
}
