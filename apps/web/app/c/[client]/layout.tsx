import Link from "next/link";
import { notFound } from "next/navigation";
import { listClients, listProposals, providerStatus, getClient, GtmError } from "@gtm/core";
import { BrainMark, ModeBadge } from "@/components/ui";
import { ClientSwitcher, Nav, ThemeToggle } from "@/components/client-bits";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  let client;
  try {
    client = getClient(slug);
  } catch (e) {
    if (e instanceof GtmError) notFound();
    throw e;
  }
  const pending = listProposals(slug, "pending").length;
  const status = providerStatus(client);
  const base = `/c/${slug}`;
  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="brand">
          <BrainMark /> GTM Brain
        </Link>
        <ClientSwitcher current={slug} clients={listClients().map((c) => ({ slug: c.slug, name: c.name }))} />
        <Nav
          base={base}
          items={[
            { href: "", label: "Overview" },
            { href: "/brain", label: "Brain files" },
            { href: "/icp", label: "ICP" },
            { href: "/accounts", label: "Accounts" },
            { href: "/writer", label: "Writer" },
            { href: "/campaigns", label: "Campaigns" },
            { href: "/approvals", label: "Approvals", count: pending },
            { href: "/spend", label: "Spend" },
            { href: "/chat", label: "Ask the brain" },
          ]}
        />
        <div style={{ marginTop: "auto" }} className="small muted">
          <div style={{ marginBottom: 6 }}>
            <ModeBadge mode={status.mode} reason={status.reason} />
          </div>
          Owner: {client.owner}
          <div className="faint">workspaces/{slug}/</div>
          <div style={{ marginTop: 10 }}>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
