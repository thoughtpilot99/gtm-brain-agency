import { z } from "zod";
import type { Account, Signal } from "../types";
import { bullets, quotes } from "../brain/markdown";
import { lintCopy, type CopyRules, type LintResult } from "./rules-lint";

export interface Source {
  id: string;
  kind: "signal" | "proof" | "product" | "quote" | "account" | "offer" | "cta";
  text: string;
  url?: string;
}

export interface Sentence {
  text: string;
  kind: "greeting" | "fact" | "opinion" | "cta";
  sources: string[];
}

export interface ClaimCheck {
  sentence: string;
  kind: Sentence["kind"];
  sources: string[];
  supported: boolean;
  problems: string[];
}

export interface DraftResult {
  subject: string;
  body: string;
  sentences: Sentence[];
  sources: Source[];
  claims: ClaimCheck[];
  lint: LintResult;
  verdict: "ready" | "needs_review" | "blocked";
  writer: "claude" | "template";
  revisions: number;
}

export interface WriterContext {
  clientName: string;
  account: Account;
  contact?: { firstName: string; lastName?: string; title?: string };
  signalIndex?: number;
  angle?: string;
  offersMd: string;
  productsMd: string[];
  callNotesMd: string[];
  icpSummary: string[];
  voice: string[];
  rules: CopyRules;
}

export function buildSources(ctx: WriterContext): Source[] {
  const out: Source[] = [];
  const a = ctx.account;
  const facts = [
    `Company: ${a.name} (${a.domain})`,
    a.industry && `Industry: ${a.industry}`,
    a.employees && `Employees: about ${a.employees}`,
    a.region && `Region: ${a.region}`,
    a.tech.length && `Tools they use: ${a.tech.join(", ")}`,
    a.description && `Description: ${a.description}`,
  ].filter(Boolean) as string[];
  out.push({ id: "A1", kind: "account", text: facts.join(". ") });
  const signals = [...a.signals].sort((x, y) => y.date.localeCompare(x.date));
  const ordered = ctx.signalIndex !== undefined && signals[ctx.signalIndex] ? [signals[ctx.signalIndex], ...signals.filter((_, i) => i !== ctx.signalIndex)] : signals;
  ordered.slice(0, 4).forEach((s: Signal, i) =>
    out.push({
      id: `S${i + 1}`,
      kind: "signal",
      text: `${s.title}${s.detail ? `. ${s.detail}` : ""} (${s.date.slice(0, 10)}, via ${s.source})${isFreshSignal(s) ? "" : ". OLD: background only, never open with it or call it recent"}`,
      url: s.url,
    }),
  );
  // A counted, citable fact for "hiring N sales roles": the verifier only accepts numbers that appear in a source.
  const gtmRoles = openGtmRoles(a.signals);
  if (gtmRoles.length >= 2) out.push({ id: "A2", kind: "account", text: `Go-to-market roles posted in the last 45 days: ${gtmRoles.length} (${gtmRoles.join("; ")})` });
  bullets(ctx.offersMd, /proof/i).slice(0, 6).forEach((p, i) => out.push({ id: `O${i + 1}`, kind: "proof", text: p }));
  bullets(ctx.offersMd, /what we sell|offer/i).slice(0, 3).forEach((p, i) => out.push({ id: `W${i + 1}`, kind: "offer", text: p }));
  bullets(ctx.offersMd, /call(s)? to action|cta/i).slice(0, 3).forEach((p, i) => out.push({ id: `C${i + 1}`, kind: "cta", text: p }));
  ctx.productsMd
    .flatMap((md) => bullets(md, /facts|what it does/i))
    .slice(0, 6)
    .forEach((p, i) => out.push({ id: `P${i + 1}`, kind: "product", text: p }));
  ctx.callNotesMd
    .flatMap((md) => quotes(md))
    .slice(0, 5)
    .forEach((q, i) => out.push({ id: `Q${i + 1}`, kind: "quote", text: q }));
  return out;
}

const COMMON = new Set(
  "I,I'm,I'd,I've,Hi,Hey,Hello,Saw,Noticed,Congrats,Congratulations,Worth,Would,Could,Can,Should,Happy,Most,Many,When,While,With,Your,You,Our,We,We're,Teams,Team,The,That,This,These,Those,It,Its,If,And,But,So,Or,Also,Just,Quick,Open,Mind,Curious,Thought,Thanks,Best,Cheers,Monday,Tuesday,Wednesday,Thursday,Friday,Q1,Q2,Q3,Q4,AI,CRM,SDR,SDRs,BDR,AE,AEs,VP,CRO,CEO,RevOps,GTM,ICP,ROI,SaaS,B2B,No,Not,How,What,Why,Who,Where,Any,Happy,Sharing,Send,Sending,Here,Glad,Since,After,Before,Given,Seems,Looks,Great,One,Two,Three".split(","),
);

/** Deterministic claim check: facts need sources; numbers and names must appear in the cited sources. */
export function verifyClaims(sentences: Sentence[], sources: Source[], ctx: { allowedNames: string[] }): ClaimCheck[] {
  const byId = new Map(sources.map((s) => [s.id.toUpperCase(), s]));
  const allText = sources.map((s) => s.text).join(" ").toLowerCase();
  const allowed = ctx.allowedNames.join(" ").toLowerCase();
  const norm = (n: string) => n.replace(/[,$]/g, "").replace(/\.$/, "");
  return sentences.map((s) => {
    const problems: string[] = [];
    const cited = s.sources.map((id) => byId.get(id.toUpperCase()));
    s.sources.forEach((id, i) => {
      if (!cited[i]) problems.push(`cites unknown source ${id}`);
    });
    const citedText = cited
      .filter(Boolean)
      .map((c) => c!.text)
      .join(" ")
      .toLowerCase();
    const pool = s.kind === "fact" ? citedText + " " + allowed : allText + " " + allowed;
    if (s.kind === "fact" && s.sources.length === 0) problems.push("states a fact without a source");
    for (const num of s.text.match(/\$?\d[\d,.]*\s?%?[kmb]?/gi) ?? []) {
      const n = norm(num.trim()).toLowerCase();
      if (n.length && !norm(pool).includes(n.replace(/\s/g, "")) && !pool.includes(n)) problems.push(`number "${num.trim()}" is not in ${s.kind === "fact" ? "the cited sources" : "any source"}`);
    }
    const words = s.text.split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9'’&.-]+$/g, "").replace(/['’]s$/, "").replace(/\.$/, "");
      if (!/^[A-Z][A-Za-z0-9&.-]{2,}$/.test(clean)) return;
      const startOfSentence = i === 0 || /[.!?:]$/.test(words[i - 1] ?? "");
      if (startOfSentence || COMMON.has(clean)) return;
      if (!pool.includes(clean.toLowerCase())) problems.push(`name "${clean}" is not in ${s.kind === "fact" ? "the cited sources" : "any source"}`);
    });
    return { sentence: s.text, kind: s.kind, sources: s.sources, supported: problems.length === 0, problems };
  });
}

export function assembleBody(sentences: Sentence[]): string {
  const greeting = sentences.filter((s) => s.kind === "greeting").map((s) => s.text);
  const middle = sentences.filter((s) => s.kind === "fact" || s.kind === "opinion").map((s) => s.text);
  const cta = sentences.filter((s) => s.kind === "cta").map((s) => s.text);
  return [greeting.join(" "), middle.join(" "), cta.join(" ")].filter((x) => x.trim()).join("\n\n");
}

export function finalizeDraft(
  subject: string,
  sentences: Sentence[],
  sources: Source[],
  ctx: WriterContext,
  writer: DraftResult["writer"],
  revisions: number,
): DraftResult {
  const allowedNames = [ctx.clientName, ctx.account.name, ctx.contact?.firstName ?? "", ctx.contact?.lastName ?? ""];
  const claims = verifyClaims(sentences, sources, { allowedNames });
  const body = assembleBody(sentences);
  // Greeting and sign-off are not counted against the first-email word limit.
  const lint = lintCopy(sentences.filter((s) => s.kind !== "greeting").map((s) => s.text).join(" "), ctx.rules);
  const lintBody = lintCopy(body, { ...ctx.rules, maxWords: Number.MAX_SAFE_INTEGER });
  const issues = [...lint.issues, ...lintBody.issues.filter((i) => !lint.issues.some((j) => j.rule === i.rule && j.match === i.match))];
  const merged: LintResult = { ok: !issues.some((i) => i.severity === "error"), words: lint.words, issues };
  const verdict = claims.some((c) => !c.supported) || !merged.ok ? "blocked" : merged.issues.length ? "needs_review" : "ready";
  return { subject, body, sentences, sources, claims, lint: merged, verdict, writer, revisions };
}

/** How long a signal is news. Older ones stay as background but never open an email ("Saw X raised..." about 2024 reads as lazy). */
export const FRESH_DAYS: Record<string, number> = { hiring: 90, funding: 180, leadership_change: 120, tech_adoption: 120, headcount_growth: 120, web_intent: 30, news: 60 };
export function isFreshSignal(s: { type: string; date: string }, at: Date = new Date()): boolean {
  const age = (at.getTime() - new Date(s.date).getTime()) / 86_400_000;
  return Number.isFinite(age) && age <= (FRESH_DAYS[s.type] ?? 90);
}

/** Sales, marketing, success and revenue roles: the hires that mean pipeline targets went up. */
export const GTM_ROLE = /sales|account (executive|manager)|\b(sdr|bdr|ae|cro)\b|business development|revenue|rev ?ops|growth|marketing|demand gen|customer success|partnerships?/i;

/** "Hiring: Regional Sales Director, NEUR" -> "Regional Sales Director" (drops location and team suffixes). */
export function cleanRole(title: string): string {
  return title
    .replace(/^Hiring:\s*/i, "")
    .split(/\s*,\s*|\s+[-–—|]\s+|\s*\(/)[0]
    .trim();
}

export const withArticle = (role: string) => `${/^[aeiou]/i.test(role) && !/^(uni|eu|one)/i.test(role) ? "an" : "a"} ${role}`;

/** Distinct open go-to-market roles from the last 45 days, newest first. */
export function openGtmRoles(signals: Signal[], at: Date = new Date()): string[] {
  const roles = signals
    .filter((s) => s.type === "hiring" && (at.getTime() - new Date(s.date).getTime()) / 86_400_000 <= 45)
    .sort((x, y) => y.date.localeCompare(x.date))
    .map((s) => cleanRole(s.title))
    .filter((r) => GTM_ROLE.test(r));
  return [...new Set(roles)];
}

/** Deterministic fallback writer used when no Anthropic key is set (or Claude declines). */
export function templateDraft(ctx: WriterContext, sources: Source[]): { subject: string; sentences: Sentence[] } {
  const a = ctx.account;
  const sentences: Sentence[] = [];
  if (ctx.contact?.firstName) sentences.push({ text: `Hi ${ctx.contact.firstName},`, kind: "greeting", sources: [] });
  const sig = sources.find((s) => s.id === "S1");
  const picked = a.signals.length ? [...a.signals].sort((x, y) => y.date.localeCompare(x.date))[ctx.signalIndex ?? 0] ?? a.signals[0] : undefined;
  const signal = picked && isFreshSignal(picked) ? picked : undefined;
  const gtm = sources.find((s) => s.id === "A2");
  const gtmCount = openGtmRoles(a.signals).length;
  if (sig && signal) {
    const t = signal.title.replace(/\.$/, "");
    let line: string;
    let cites = ["S1", "A1"];
    if (signal.type === "hiring") {
      const role = cleanRole(t);
      if (gtm && gtmCount >= 2 && GTM_ROLE.test(role)) {
        line = `Saw ${a.name} has ${gtmCount} go-to-market roles open, including ${withArticle(role)}.`;
        cites = ["A2", "S1", "A1"];
      } else line = `Saw ${a.name} is hiring ${withArticle(role)}.`;
    } else if (signal.type === "funding") line = `Saw ${a.name} ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
    else if (signal.type === "leadership_change") line = `Saw a ${t.charAt(0).toLowerCase()}${t.slice(1)} at ${a.name}.`;
    else line = `Noticed ${a.name}: ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
    sentences.push({ text: line, kind: "fact", sources: cites });
    sentences.push({ text: "That usually means pipeline targets just went up.", kind: "opinion", sources: [] });
  } else {
    sentences.push({ text: `${a.name} looks like the teams we work with best.`, kind: "opinion", sources: [] });
  }
  const proof = sources.find((s) => s.kind === "proof");
  if (proof) sentences.push({ text: proof.text.replace(/\.?$/, "."), kind: "fact", sources: [proof.id] });
  const cta = sources.find((s) => s.kind === "cta");
  sentences.push({
    text: cta
      ? `Worth me sending ${cta.text.charAt(0).toLowerCase()}${cta.text.slice(1).replace(/\.$/, "")}?`
      : proof
        ? "Open to a short note on how they did it?"
        : "Open to comparing notes on how other teams handle it?",
    kind: "cta",
    sources: cta ? [cta.id] : [],
  });
  const subject = signal
    ? signal.type === "hiring"
      ? gtm && gtmCount >= 2
        ? `${a.name} gtm hiring`
        : `${cleanRole(signal.title)} hire`
      : signal.title.replace(/^Raised\s+/i, "").replace(/^an?\s+/i, "").slice(0, 40)
    : `${a.name} + ${ctx.clientName}`;
  return { subject: subject.toLowerCase(), sentences };
}

export const DraftSchema = z.object({
  subject: z.string().describe("2-5 words, lowercase, no clickbait"),
  sentences: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(["greeting", "fact", "opinion", "cta"]),
        sources: z.array(z.string()).describe("Source ids this sentence relies on, e.g. S1, O2. Empty only for greeting/opinion/cta."),
      }),
    )
    .describe("The email in order, one sentence per item"),
});

export function writerPrompt(ctx: WriterContext, sources: Source[], feedback?: string[]): { system: string; prompt: string } {
  const system = [
    `You write first-touch cold emails for ${ctx.clientName}.`,
    "You may only state facts that appear in the numbered sources. Each fact sentence must list the ids it relies on.",
    "Never invent a number, a name, a customer, a quote or a result. If a fact is missing, leave it out.",
    "Open with the buyer's situation behind the strongest signal, in plain words. One idea per email. Peer tone, not vendor tone.",
    `Rules: at most ${ctx.rules.maxWords} words excluding the greeting, ${ctx.rules.allowLinks ? "links allowed" : "no links"}, at most ${ctx.rules.maxQuestions} question, plain text, no exclamation marks.`,
    ctx.rules.bannedWords.length ? `Never use these words: ${ctx.rules.bannedWords.join(", ")}.` : "",
    ctx.rules.bannedClaims.length ? `Never make these claims: ${ctx.rules.bannedClaims.join("; ")}.` : "",
    ctx.voice.length ? `Voice: ${ctx.voice.join(" ")}` : "",
    "End with one low-friction call to action drawn from the C sources when present.",
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = [
    `Recipient: ${ctx.contact ? `${ctx.contact.firstName} ${ctx.contact.lastName ?? ""}, ${ctx.contact.title ?? ""}`.trim() : "unknown (skip the greeting)"}`,
    `Account: ${ctx.account.name}`,
    ctx.angle ? `Angle to use: ${ctx.angle}` : "",
    ctx.icpSummary.length ? `Why this account fits our ICP: ${ctx.icpSummary.join("; ")}` : "",
    "",
    "Sources:",
    ...sources.map((s) => `[${s.id}] (${s.kind}) ${s.text}`),
    feedback?.length ? `\nYour previous draft failed these checks. Fix every one:\n- ${feedback.join("\n- ")}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system, prompt };
}
