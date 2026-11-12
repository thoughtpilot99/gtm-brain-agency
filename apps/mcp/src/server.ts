import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_TOOLS, runTool, listClients, listBrainFiles, readBrainFile } from "@gtm/core";

const INSTRUCTIONS = `GTM Brain: one brain per client (ICP, offers, rules, products, past campaigns, call notes) plus live data.
Start with list_clients, then client_overview. Before any GTM task call read_brain for icp.md, offers.md and rules.md.
Never invent facts. write_email checks every sentence against sources; do not send a draft whose verdict is "blocked".
icp.md, offers.md, rules.md, AGENTS.md and products/ change only through propose_brain_change; the brain owner approves them in the web app or with "gtm approve" (agents cannot approve).
Work in batches of 100 and let a person check each batch. After a campaign, run close_campaign.`;

export function createServer(): McpServer {
  const server = new McpServer({ name: "gtm-brain", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  const actor = () => process.env.GTM_ACTOR ?? server.server.getClientVersion()?.name ?? "mcp-agent";

  for (const t of AGENT_TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input.shape,
        annotations: { readOnlyHint: !t.mutates, openWorldHint: ["search_companies", "find_signals", "find_people", "enrich_contact", "prospect_from_icp", "score_accounts"].includes(t.name) },
      },
      async (args: Record<string, unknown>) => {
        const r = await runTool(t.name, args, { actor: actor() });
        if (!r.ok) return { isError: true, content: [{ type: "text" as const, text: `${r.code}: ${r.error}` }] };
        return { content: [{ type: "text" as const, text: JSON.stringify(r.result, null, 2) }] };
      },
    );
  }

  server.registerResource(
    "brain-file",
    new ResourceTemplate("brain://{client}/{+path}", {
      list: async () => ({
        resources: listClients().flatMap((c) =>
          listBrainFiles(c.slug)
            .filter((f) => f.path.endsWith(".md"))
            .map((f) => ({ uri: `brain://${c.slug}/${f.path}`, name: `${c.name}: ${f.path}`, mimeType: "text/markdown" })),
        ),
      }),
    }),
    { title: "Brain file", description: "A Markdown file from a client's brain folder", mimeType: "text/markdown" },
    async (uri, vars) => {
      const text = readBrainFile(String(vars.client), String(vars.path)) ?? "not found";
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    },
  );

  return server;
}
