import Link from "next/link";
import { listDrafts, listAccounts, getAccount, llmAvailable, type ClaimCheck, type Source, type LintResult } from "@gtm/core";
import { Flash, PageHead, Empty, daysAgo } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { writeAction } from "@/app/actions";

const VERDICT: Record<string, { label: string; cls: string; text: string }> = {
  ready: { label: "Ready", cls: "good", text: "Every fact traces to a source and the copy passes rules.md." },
  needs_review: { label: "Needs review", cls: "warn", text: "Facts check out, but the copy has warnings to look at." },
  blocked: { label: "Blocked", cls: "bad", text: "A sentence makes a claim the sources do not support, or the copy breaks a rule. Do not send it." },
};

export default async function WriterPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string; draft?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const drafts = listDrafts(client, 40);
  const current = drafts.find((d) => String(d.id) === sp.draft) ?? drafts[0];
  const targets = listAccounts(client, { limit: 60 }).filter((a) => a.tier === "Tier 1" || a.tier === "Tier 2");
  const claims = (current?.claims ?? []) as ClaimCheck[];
  const sources = (current?.sources ?? []) as Source[];
  const lint = (current?.lint ?? { issues: [], words: 0, ok: true }) as LintResult;
  const v = current ? VERDICT[current.verdict] : null;
  const acct = current ? getAccount(client, current.domain) : undefined;

  return (
    <>
      <PageHead
        title="Writer"
        lead="First emails written from each account's strongest signal. Each sentence is checked against numbered sources from the brain: signals, proof in offers.md, product facts and buyer quotes. Numbers or names that aren't in a source block the draft."
      />
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />
      {!llmAvailable() ? (
        <div className="notice warn" style={{ marginBottom: 18 }}>
          No ANTHROPIC_API_KEY, so drafts use the built-in template writer. Add the key to .env.local for drafts written by Claude, which go through the same checks.
        </div>
      ) : null}

      <form action={writeAction.bind(null, client)} className="panel" style={{ marginBottom: 18 }}>
        <div className="form-row">
          <label className="field" style={{ gridColumn: "span 2" }}>
            Account
            <select className="select" name="domain" required defaultValue="">
              <option value="" disabled>
                Choose a Tier 1 or Tier 2 account
              </option>
              {targets.map((a) => (
                <option key={a.domain} value={a.domain}>
                  {a.name} ({a.tier}, {a.score})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            First name
            <input className="input" name="first" placeholder="Optional" />
          </label>
          <label className="field">
            Angle
            <input className="input" name="angle" placeholder="Optional, e.g. SDR hiring" />
          </label>
          <div>
            <Submit pendingText="Writing and checking…">Write email</Submit>
          </div>
        </div>
      </form>

      {!current ? (
        <div className="panel">
          <Empty title="No drafts yet">Pick an account above, or open an account and press Write email next to a contact.</Empty>
        </div>
      ) : (
        <div className="grid-2">
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>{acct?.name ?? current.domain}</h2>
                  <p className="small muted">
                    Subject: {current.subject} · {lint.words} words · written by {current.writer === "claude" ? "Claude" : "template"} · {daysAgo(current.createdAt)}
                  </p>
                </div>
                {v ? <span className={`pill ${v.cls}`}>{v.label}</span> : null}
              </div>
              <div className="email">{current.body}</div>
              {v ? <div className={`notice ${v.cls === "good" ? "good" : v.cls === "bad" ? "bad" : "warn"}`} style={{ marginTop: 14 }}>{v.text}</div> : null}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Claim ledger</h2>
                <p>Each sentence and the evidence behind it.</p>
              </div>
              <div className="ledger">
                {claims.map((c, i) => {
                  const mark = c.kind === "fact" ? (c.supported ? "ok" : "no") : c.supported ? "na" : "no";
                  return (
                    <div key={i} className="ledger-row">
                      <span className={`ledger-mark ${mark}`} aria-label={c.supported ? "supported" : "not supported"}>
                        {mark === "ok" ? "✓" : mark === "no" ? "✗" : "·"}
                      </span>
                      <div>
                        <div>{c.sentence}</div>
                        {c.problems.length ? <div className="small" style={{ color: "var(--bad)", marginTop: 2 }}>{c.problems.join("; ")}</div> : null}
                      </div>
                      <div style={{ whiteSpace: "nowrap" }}>
                        <span className="small faint">{c.kind}</span>
                        {c.sources.map((s) => (
                          <span key={s} className="src">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              {lint.issues.length ? (
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ marginBottom: 6 }}>rules.md</h3>
                  {lint.issues.map((i, k) => (
                    <div key={k} className="small" style={{ color: i.severity === "error" ? "var(--bad)" : "var(--warn)" }}>
                      {i.severity === "error" ? "Error" : "Warning"}: {i.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <h2>Sources</h2>
                <p>Only these may be stated as fact.</p>
              </div>
              {sources.map((s) => (
                <div key={s.id} className="check" style={{ gridTemplateColumns: "34px minmax(0,1fr)" }}>
                  <span className="src" style={{ marginLeft: 0, height: "fit-content" }}>
                    {s.id}
                  </span>
                  <div className="small">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.text}
                      </a>
                    ) : (
                      s.text
                    )}
                    <div className="faint">{s.kind}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel">
              <h2 style={{ marginBottom: 8 }}>Recent drafts</h2>
              {drafts.map((d) => (
                <Link
                  key={d.id}
                  href={`/c/${client}/writer?draft=${d.id}`}
                  className="check"
                  style={{ gridTemplateColumns: "minmax(0,1fr) auto", textDecoration: "none", background: d.id === current.id ? "var(--sunk)" : undefined, padding: "8px 6px", borderRadius: 6 }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{getAccount(client, d.domain)?.name ?? d.domain}</div>
                    <div className="small faint">{d.subject}</div>
                  </div>
                  <span className={`pill ${VERDICT[d.verdict]?.cls ?? ""}`}>{VERDICT[d.verdict]?.label ?? d.verdict}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
