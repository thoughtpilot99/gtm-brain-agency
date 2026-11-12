import Anthropic from "@anthropic-ai/sdk";
import { anthropic, llmAvailable, llmModel, recordLlmUsage, runTool, toolJsonSchemas, getClient, readBrainFile, GtmError } from "@gtm/core";

export const runtime = "nodejs";
export const maxDuration = 300;

type Incoming = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 12;

function systemPrompt(slug: string): string {
  const c = getClient(slug);
  const agents = readBrainFile(slug, "AGENTS.md") ?? "";
  return [
    `You are the GTM brain for ${c.name}, used by the agency team. The brain owner is ${c.owner}.`,
    `Always pass client: "${slug}" to tools. Use tools to answer; do not guess numbers, names or facts. If a tool returns nothing, say "not found".`,
    "Keep answers short and concrete: tables or short lists for accounts, numbers with their source.",
    "You can propose brain changes but cannot approve them; tell the user the owner approves in Approvals.",
    "Before spending credits on many lookups (more than 25 accounts or contacts), say how many calls it will take and ask first.",
    "",
    "Client instructions (AGENTS.md):",
    agents,
  ].join("\n");
}

/**
 * Streams newline-delimited JSON events: {type:"text",delta} {type:"tool",name,input} {type:"tool_result",name,ok,summary} {type:"done"} {type:"error",message}.
 * Manual tool loop over the shared registry (same tools as the MCP server, minus human-only approvals).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { client?: string; messages?: Incoming[] } | null;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: Record<string, unknown>) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        if (!body?.client || !body.messages?.length) throw new GtmError("Send a client and at least one message.");
        if (!llmAvailable()) throw new GtmError("Add ANTHROPIC_API_KEY to .env.local to chat with the brain.");
        const slug = body.client;
        const system = systemPrompt(slug);
        const tools: Anthropic.Tool[] = toolJsonSchemas().map((t) => ({ ...t, input_schema: t.input_schema as Anthropic.Tool.InputSchema, eager_input_streaming: true }));
        const messages: Anthropic.MessageParam[] = body.messages
          .filter((m) => m.content?.trim())
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content }));
        const model = llmModel();
        let jsonRetries = 0;

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const s = anthropic().messages.stream({
            model,
            max_tokens: 16000,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools,
            messages,
            output_config: { effort: "medium" },
          });
          s.on("text", (delta) => send({ type: "text", delta }));
          let message: Anthropic.Message;
          try {
            message = await s.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
            continue; // tool input was not parseable JSON: re-issue the turn
          }
          recordLlmUsage(slug, "chat", model, message.usage);

          if (message.stop_reason === "refusal") {
            send({ type: "text", delta: "\n\nClaude declined this request." });
            break;
          }
          if (message.stop_reason === "pause_turn") {
            messages.push({ role: "assistant", content: message.content });
            continue;
          }
          const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          // A tool input cut off at max_tokens can parse as a valid but truncated object: never run it.
          if (message.stop_reason === "max_tokens") throw new GtmError("The answer was cut off. Ask a narrower question.");
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;

          messages.push({ role: "assistant", content: message.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "tool", name: tu.name, input: tu.input });
            // runTool validates the input against the tool's Zod schema before running it.
            const r = await runTool(tu.name, tu.input, { actor: "web-chat" });
            const text = r.ok ? JSON.stringify(r.result) : `${r.code}: ${r.error}`;
            send({ type: "tool_result", name: tu.name, ok: r.ok, summary: r.ok ? summarize(r.result) : r.error });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: text.length > 60000 ? text.slice(0, 60000) + "…(truncated)" : text, is_error: !r.ok });
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done" });
      } catch (e) {
        const message =
          e instanceof Anthropic.AuthenticationError
            ? "Anthropic rejected the API key in .env.local."
            : e instanceof Anthropic.RateLimitError
              ? "Rate limited by Anthropic. Try again in a moment."
              : e instanceof Error
                ? e.message
                : String(e);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

function summarize(v: unknown): string {
  if (Array.isArray(v)) return `${v.length} result${v.length === 1 ? "" : "s"}`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.verdict === "string") return `draft ${o.verdict}`;
    if (o.tiers) return `tiers ${JSON.stringify(o.tiers)}`;
    if (typeof o.count === "number") return `${o.count} results`;
    if (typeof o.found === "number") return `${o.found} found`;
    return Object.keys(o).slice(0, 4).join(", ");
  }
  return String(v).slice(0, 80);
}
