import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "./env";
import { now, run } from "./db";

/** Default model for every reasoning step. Override with GTM_MODEL in .env.local. */
export const DEFAULT_MODEL = "claude-opus-5-5";

/** $ per million tokens (input, output) for cost tracking in the Spend ledger. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-2": [8, 40],
};

export class LlmError extends Error {
  constructor(
    message: string,
    public code: "no_key" | "refusal" | "truncated" | "parse" | "api",
  ) {
    super(message);
  }
}

let client: Anthropic | null = null;
export function llmAvailable(): boolean {
  return !!env("ANTHROPIC_API_KEY");
}
export function llmModel(): string {
  return env("GTM_MODEL") ?? DEFAULT_MODEL;
}
export function anthropic(): Anthropic {
  if (!llmAvailable()) throw new LlmError("ANTHROPIC_API_KEY is not set in .env.local", "no_key");
  client ??= new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return client;
}

export function recordLlmUsage(slug: string | null, action: string, model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  const [pin, pout] = PRICES[model] ?? PRICES[DEFAULT_MODEL];
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) * 0.1;
  const usd = (input * pin + (usage.output_tokens ?? 0) * pout) / 1_000_000;
  run(
    "INSERT INTO ledger (client, provider, action, credits, usd, cached, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
    slug ?? "_system",
    "anthropic",
    action,
    0,
    usd,
    0,
    JSON.stringify({ model, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }),
    now(),
  );
}

/**
 * One structured call: Claude returns JSON validated against a Zod schema.
 * Throws LlmError on refusal / truncation so callers can fall back to deterministic logic.
 */
export async function generateJson<T extends z.ZodType>(
  schema: T,
  opts: { system: string; prompt: string; slug?: string; action: string; effort?: "low" | "medium" | "high"; maxTokens?: number },
): Promise<z.infer<T>> {
  const model = llmModel();
  let response;
  try {
    response = await anthropic().messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      output_config: { format: zodOutputFormat(schema), effort: opts.effort ?? "medium" },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new LlmError("Anthropic rejected the API key", "api");
    if (e instanceof Anthropic.RateLimitError) throw new LlmError("Anthropic rate limit hit. Try again shortly.", "api");
    if (e instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error ${e.status}: ${e.message}`, "api");
    throw new LlmError(e instanceof Error ? e.message : String(e), "api");
  }
  recordLlmUsage(opts.slug ?? null, opts.action, model, response.usage);
  if (response.stop_reason === "refusal") throw new LlmError("Claude declined this request", "refusal");
  if (response.stop_reason === "max_tokens") throw new LlmError("Response was cut off (max_tokens)", "truncated");
  if (!response.parsed_output) throw new LlmError("Claude's output did not match the expected format", "parse");
  return response.parsed_output as z.infer<T>;
}
