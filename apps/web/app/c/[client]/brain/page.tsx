import Link from "next/link";
import { listBrainFiles, readBrainFile, brainHealth, isProtected, getClient } from "@gtm/core";
import { Flash, PageHead, fmtDate } from "@/components/ui";
import { Submit } from "@/components/client-bits";
import { proposeAction } from "@/app/actions";

const KIND_LABEL: Record<string, string> = {
  instructions: "Agent instructions",
  core: "Core",
  product: "Products",
  "call-note": "Call notes",
  campaign: "Past campaigns",
  data: "Data",
  other: "Other",
};

export default async function BrainPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<{ msg?: string; err?: string; file?: string; edit?: string }> }) {
  const { client } = await params;
  const sp = await searchParams;
  const c = getClient(client);
  const files = listBrainFiles(client).filter((f) => !f.path.endsWith(".keep"));
  const selected = sp.file && files.some((f) => f.path === sp.file) ? sp.file : (files.find((f) => f.path === "icp.md")?.path ?? files[0]?.path);
  const content = selected ? readBrainFile(client, selected) : null;
  const health = brainHealth(client);
  const groups = Object.keys(KIND_LABEL).filter((k) => files.some((f) => f.kind === k));
  const editing = sp.edit === "1" && selected && !selected.endsWith(".csv");

  return (
    <>
      <PageHead
        title="Brain files"
        lead={`The files every agent reads, in workspaces/${client}/. Protected files change through a proposal that ${c.owner} approves. Notes and data save directly.`}
      />
      <Flash msg={sp.msg ?? sp.err} kind={sp.err ? "error" : "ok"} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr) minmax(240px, 300px)", gap: 18, alignItems: "start" }} className="brain-grid">
        <nav className="panel" aria-label="Brain files" style={{ padding: "14px 12px" }}>
          {groups.map((g) => (
            <div key={g} style={{ marginBottom: 12 }}>
              <div className="small faint" style={{ padding: "0 8px 4px" }}>
                {KIND_LABEL[g]}
              </div>
              {files
                .filter((f) => f.kind === g)
                .map((f) => (
                  <Link
                    key={f.path}
                    href={`/c/${client}/brain?file=${encodeURIComponent(f.path)}`}
                    aria-current={f.path === selected ? "page" : undefined}
                    style={{ display: "block", padding: "4px 8px", borderRadius: 5, textDecoration: "none", fontSize: "0.88rem", background: f.path === selected ? "var(--sunk)" : undefined, fontWeight: f.path === selected ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {f.path.split("/").pop()}
                  </Link>
                ))}
            </div>
          ))}
        </nav>

        <div className="panel">
          {selected ? (
            <>
              <div className="panel-head">
                <div>
                  <h2>{selected}</h2>
                  <p className="small muted">
                    {isProtected(selected) ? "Protected: edits become a proposal" : "Saves directly"} · updated {fmtDate(files.find((f) => f.path === selected)?.modifiedAt)}
                  </p>
                </div>
                {!editing && !selected.endsWith(".csv") ? (
                  <Link className="btn" href={`/c/${client}/brain?file=${encodeURIComponent(selected)}&edit=1`}>
                    {isProtected(selected) ? "Propose a change" : "Edit"}
                  </Link>
                ) : null}
              </div>
              {editing ? (
                <form action={proposeAction.bind(null, client)}>
                  <input type="hidden" name="path" value={selected} />
                  <textarea className="textarea" name="content" defaultValue={content ?? ""} style={{ minHeight: 420 }} aria-label={`Contents of ${selected}`} />
                  <div className="form-row" style={{ marginTop: 12 }}>
                    <label className="field">
                      Why
                      <input className="input" name="reason" required placeholder="What changed and why" />
                    </label>
                    <label className="field">
                      Your name
                      <input className="input" name="as" required />
                    </label>
                  </div>
                  <div className="actions" style={{ marginTop: 12 }}>
                    <Submit pendingText="Saving…">{isProtected(selected) ? "Send for approval" : "Save"}</Submit>
                    <Link className="btn ghost" href={`/c/${client}/brain?file=${encodeURIComponent(selected)}`}>
                      Cancel
                    </Link>
                  </div>
                </form>
              ) : (
                <div className="doc">{content}</div>
              )}
            </>
          ) : (
            <p className="muted">No files yet.</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Health</h2>
            <span className="display num" style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {health.score}
            </span>
          </div>
          {health.checks.map((ch) => (
            <div key={ch.id} className="check">
              <span className={`dot ${ch.status}`} aria-label={ch.status} />
              <div>
                <div className="small" style={{ fontWeight: 600 }}>
                  {ch.label}
                </div>
                <div className="small muted">{ch.detail}</div>
                {ch.fix ? <div className="small" style={{ color: "var(--warn)", marginTop: 2 }}>{ch.fix}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <style>{`@media (max-width: 1100px){ .brain-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
