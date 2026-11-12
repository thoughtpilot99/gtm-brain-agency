import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { env, ROOT } from "@gtm/core";
import { createServer } from "./server";

/**
 * Streamable HTTP transport (stateless) for agents that connect by URL: Grok Bot, a remote Codex, etc.
 *
 * A token is always required, because a tunnel (Cloudflare, ngrok) makes this reachable from the internet
 * and the tools can spend provider credits. Clients can send it any of these ways:
 *   Authorization: Bearer <token>            (clients that support headers)
 *   https://<host>/mcp/<token>                (URL-only clients such as Grok Bot)
 *   https://<host>/mcp?key=<token>
 * If GTM_MCP_TOKEN is not set, one is generated and saved to .env.local so the URL stays the same.
 */
// 8787: outside the port ranges Windows often reserves for Hyper-V/WSL (e.g. 3285-3384).
const port = Number(env("GTM_MCP_PORT") ?? 8787);
const host = env("GTM_MCP_HOST") ?? "127.0.0.1";
const token = env("GTM_MCP_TOKEN") ?? createToken();

function createToken(): string {
  const t = crypto.randomBytes(24).toString("base64url");
  const file = path.join(ROOT, ".env.local");
  const line = `\n# Secret for the HTTP MCP server (Grok Bot etc.). Anyone with it can use your tools.\nGTM_MCP_TOKEN=${t}\n`;
  fs.appendFileSync(file, line, "utf8");
  console.error("Generated GTM_MCP_TOKEN and saved it to .env.local");
  return t;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Returns the token the client sent, or null. */
function presentedToken(req: http.IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const fromPath = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);
  return url.searchParams.get("key");
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  if (!url.pathname.startsWith("/mcp")) return json(res, 404, { error: "Not found. The MCP endpoint is /mcp" });

  const got = presentedToken(req, url);
  if (!got || !safeEqual(got, token)) {
    console.error(`rejected ${req.method} ${url.pathname.replace(/\/mcp\/.+/, "/mcp/***")}: missing or wrong token`);
    return json(res, 401, { error: "unauthorized: send the GTM_MCP_TOKEN" });
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null }));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 5_000_000) return json(res, 413, { error: "request too large" });
    chunks.push(c as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    return json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error("MCP request failed:", e instanceof Error ? e.message : e);
    if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});

httpServer.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EACCES" || e.code === "EADDRINUSE") {
    console.error(`Port ${port} is ${e.code === "EADDRINUSE" ? "already in use" : "reserved by Windows"}. Set GTM_MCP_PORT in .env.local to another port (e.g. 8788).`);
  } else console.error(e.message);
  process.exit(1);
});

httpServer.listen(port, host, () => {
  console.error(`gtm-brain MCP server listening on http://${host}:${port}/mcp (token required)`);
  console.error(`Local test URL:  http://${host}:${port}/mcp/${token}`);
  console.error("For Grok Bot: expose this port with a tunnel, then give it  https://<your-tunnel-host>/mcp/<GTM_MCP_TOKEN>");
});
