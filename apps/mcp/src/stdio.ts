import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

// stdout carries the MCP protocol; anything human-readable goes to stderr.
const server = createServer();
await server.connect(new StdioServerTransport());
console.error("gtm-brain MCP server running on stdio");
