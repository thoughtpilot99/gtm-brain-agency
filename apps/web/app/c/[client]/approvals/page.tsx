import { cookies } from "next/headers";
import { listProposals, listVersions, getClient } from "@gtm/core";
import { Flash, PageHead, Empty, daysAgo, fmtDate } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { decideAction, rollbackAction } from "@/app/actions";

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const c = getClient(client);
  const me = (await cookies()).get("gtm_user")?.value ?? "";
  const pending = listProposals(client, "pending");
  const decided = listProposals(client, "all").filter((p) => p.status !== "pending").slice(0, 15);
  const versions = listVersions(client).filter((v) => !v.path.startsWith("data/")).slice(0, 25);

  return (
    <>
      <PageHead
        title="Approvals"
        lead={`Agents and teammates propose changes to icp.md, offers.md, rules.md, AGENTS.md and products/. Nothing changes until ${c.owner}, the brain owner, approves. AI agents can propose but never approve.`}
      />
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />

      {pending.length === 0 ? (
        <div className="panel">
          <Empty title="Nothing waiting">New proposals from agents, ICP rebuilds and closed campaigns appear here.</Empty>
        </div>
      ) : (
        pending.map((p) => (
          <div key={p.id} className="panel">
            <div className="panel-head">
              <div>
                <h2>
                  {p.path} <span className="faint num">#{p.id}</span>
                </h2>
                <p className="small muted">
                  {p.reason} · proposed by {p.author} {daysAgo(p.createdAt)} ·{" "}
                  <span style={{ color: "var(--t1)" }}>+{p.stats.added}</span> <span style={{ color: "var(--bad)" }}>−{p.stats.removed}</span>
                </p>
              </div>
            </div>
            <div className="diff">
              {collapse(p.diff).map((d, i) =>
                d.op === "gap" ? (
                  <div key={i} className="same">
                    ⋯ {d.n} unchanged lines
                  </div>
                ) : (
                  <div key={i} className={d.op}>
                    {d.op === "add" ? "+ " : d.op === "del" ? "− " : "  "}
                    {d.text || " "}
                  </div>
                ),
              )}
            </div>
            <form action={decideAction.bind(null, client, p.id)} className="actions" style={{ marginTop: 14 }}>
              <input className="input" name="as" defaultValue={me} placeholder={`Your name (owner: ${c.owner})`} required style={{ width: 260 }} aria-label="Your name" />
              <Submit name="decision" value="approve" pendingText="Applying…">
                Approve and apply
              </Submit>
              <Submit name="decision" value="reject" className="btn danger" pendingText="Rejecting…">
                Reject
              </Submit>
            </form>
          </div>
        ))
      )}

      <div className="grid-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <h2 style={{ marginBottom: 10 }}>Decided</h2>
          {decided.length ? (
            decided.map((p) => (
              <div key={p.id} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                <div>
                  <div>
                    {p.path} <span className="faint">#{p.id}</span>
                  </div>
                  <div className="small faint">
                    {p.reason} · {p.decidedBy ? `${p.status} by ${p.decidedBy}` : p.status} {p.decidedAt ? fmtDate(p.decidedAt) : ""}
                  </div>
                </div>
                <span className={`pill ${p.status === "approved" ? "good" : p.status === "rejected" ? "bad" : ""}`}>{p.status}</span>
              </div>
            ))
          ) : (
            <p className="small muted">No decisions yet.</p>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>History</h2>
            <p>Every version is kept. Restoring one files a proposal.</p>
          </div>
          {versions.map((v) => (
            <div key={v.id} className="check" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <div>
                <div className="small">{v.path}</div>
                <div className="small faint">
                  {v.author} · {fmtDate(v.createdAt)}
                  {v.note ? ` · ${v.note}` : ""}
                </div>
              </div>
              <form action={rollbackAction.bind(null, client, v.id)}>
                <Submit className="btn" pendingText="Filing…">
                  Restore
                </Submit>
              </form>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

type Line = { op: "same" | "add" | "del"; text: string } | { op: "gap"; n: number };
/** Show changed lines with 2 lines of context, folding long unchanged runs. */
function collapse(diff: { op: "same" | "add" | "del"; text: string }[]): Line[] {
  const keep = diff.map((d, i) => d.op !== "same" || diff.slice(Math.max(0, i - 2), i + 3).some((x) => x.op !== "same"));
  const out: Line[] = [];
  let gap = 0;
  diff.forEach((d, i) => {
    if (keep[i]) {
      if (gap) out.push({ op: "gap", n: gap });
      gap = 0;
      out.push(d);
    } else gap++;
  });
  if (gap) out.push({ op: "gap", n: gap });
  return out;
}
