import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccount, listContacts, SIGNAL_RULES, signalStrength, type WaterfallStep } from "@gtm/core";
import { Flash, PageHead, TierBadge, Meter, Empty, daysAgo } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { emailAction, peopleAction, rescoreOneAction, signalsAction, writeAction } from "@/app/actions";

export default async function AccountPage({ params, searchParams }: { params: Promise<{ client: string; domain: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { client, domain: raw } = await params;
  const domain = decodeURIComponent(raw);
  const sp = await searchParams;
  const a = getAccount(client, domain);
  if (!a) notFound();
  const contacts = listContacts(client, domain);
  const signals = [...a.signals].sort((x, y) => y.date.localeCompare(x.date));

  return (
    <>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href={`/c/${client}/accounts`} className="muted">
          Accounts
        </Link>
      </p>
      <PageHead title={a.name} lead={[a.domain, a.industry, a.employees ? `${a.employees} people` : null, a.region].filter(Boolean).join(" · ")}>
        <form action={signalsAction.bind(null, client, domain)}>
          <Submit className="btn" pendingText="Looking…">
            Refresh signals
          </Submit>
        </form>
        <form action={rescoreOneAction.bind(null, client, domain)}>
          <Submit className="btn" pendingText="Scoring…">
            Re-score
          </Submit>
        </form>
      </PageHead>
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      <div className="grid-2">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>Why this score</h2>
              <div className="actions">
                <TierBadge tier={a.tier} />
                <span className="display num" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
                  {a.score ?? "–"}
                </span>
              </div>
            </div>
            <Meter fit={a.fit} intent={a.intent} />
            <p className="small muted" style={{ margin: "6px 0 10px" }}>
              Fit {a.fit ?? 0} of 60 from the ICP, intent {a.intent ?? 0} of 40 from signals.
            </p>
            {a.reasons.map((r) => (
              <div key={r} className="small" style={{ padding: "3px 0", color: r.startsWith("×") ? "var(--bad)" : r.startsWith("+") ? "var(--ink)" : "var(--faint)" }}>
                {r}
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>Signals</h2>
              <p>Points fade by half every half-life.</p>
            </div>
            {signals.length ? (
              signals.map((s, i) => (
                <div key={i} className="check" style={{ gridTemplateColumns: "110px minmax(0,1fr) auto" }}>
                  <span className="small muted">{daysAgo(s.date)}</span>
                  <div>
                    <div>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</div>
                    <div className="small faint">
                      {SIGNAL_RULES[s.type]?.label} · half-life {SIGNAL_RULES[s.type]?.halfLife} days · via {s.source}
                    </div>
                  </div>
                  <span className="num small" style={{ color: "var(--signal)", fontWeight: 600 }}>
                    +{signalStrength(s).toFixed(1)}
                  </span>
                </div>
              ))
            ) : (
              <Empty title="No signals yet">Refresh signals to check funding, hiring, new leaders, headcount growth and new tools.</Empty>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <h2>People</h2>
            </div>
            {a.suppressed ? <div className="notice bad" style={{ marginBottom: 12 }}>Suppressed: {a.suppressed}. Contacts here will not be enriched.</div> : null}
            {contacts.map((p) => {
              const steps = (p.waterfall ?? []) as WaterfallStep[];
              const statusCls = p.emailStatus === "verified" ? "good" : p.emailStatus === "invalid" || p.emailStatus === "not_found" ? "bad" : p.emailStatus ? "warn" : "";
              return (
                <div key={p.id} className="check" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                  <div>
                    <div className="actions" style={{ justifyContent: "space-between" }}>
                      <div>
                        <strong>
                          {p.firstName} {p.lastName}
                        </strong>
                        <div className="small muted">{p.title}</div>
                      </div>
                      <div className="actions">
                        {p.emailStatus ? <span className={`pill ${statusCls}`}>{p.emailStatus.replace("_", " ")}</span> : null}
                        {!p.email && !a.suppressed ? (
                          <form action={emailAction.bind(null, client, domain)}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="first" value={p.firstName} />
                            <input type="hidden" name="last" value={p.lastName} />
                            <input type="hidden" name="title" value={p.title} />
                            <Submit className="btn" pendingText="Finding…">
                              Find email
                            </Submit>
                          </form>
                        ) : null}
                        <form action={writeAction.bind(null, client)}>
                          <input type="hidden" name="domain" value={domain} />
                          <input type="hidden" name="contact_id" value={p.id} />
                          <Submit className="btn" pendingText="Writing…">
                            Write email
                          </Submit>
                        </form>
                      </div>
                    </div>
                    {p.email ? <div className="small" style={{ marginTop: 4 }}>{p.email}</div> : null}
                    {steps.length ? (
                      <details style={{ marginTop: 6 }}>
                        <summary className="small faint">How we found it ({steps.length} steps)</summary>
                        <ol className="small muted" style={{ margin: "6px 0 0 18px" }}>
                          {steps.map((s, i) => (
                            <li key={i}>
                              {s.provider}, {s.action}: {s.outcome}
                              {s.cached ? " (cached, free)" : s.credits ? ` (${s.credits} credits)` : ""}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <form action={peopleAction.bind(null, client, domain)} className="form-row" style={{ marginTop: 14 }}>
              <label className="field">
                Titles to look for
                <input className="input" name="titles" placeholder="VP Sales, Head of RevOps" />
              </label>
              <div>
                <Submit className="btn" pendingText="Searching…">
                  Find people
                </Submit>
              </div>
            </form>
          </div>
          <div className="panel">
            <h2 style={{ marginBottom: 10 }}>Firmographics</h2>
            {[
              ["Domain", a.domain],
              ["Industry", a.industry],
              ["Employees", a.employees],
              ["Region", [a.region, a.country].filter(Boolean).join(", ")],
              ["Tools", a.tech.join(", ")],
              ["Source", a.source],
            ].map(([k, v]) => (
              <div key={String(k)} className="check" style={{ gridTemplateColumns: "110px 1fr" }}>
                <span className="small muted">{k}</span>
                <span className="small">{v || <span className="faint">not found</span>}</span>
              </div>
            ))}
            {a.description ? <p className="small muted" style={{ marginTop: 10 }}>{a.description}</p> : null}
          </div>
        </div>
      </div>
    </>
  );
}
