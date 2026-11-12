import { bullets, keyValues } from "../brain/markdown";

export interface LintIssue {
  rule: string;
  severity: "error" | "warning";
  message: string;
  match?: string;
}

export interface LintResult {
  ok: boolean;
  words: number;
  issues: LintIssue[];
}

export interface CopyRules {
  maxWords: number;
  allowLinks: boolean;
  maxQuestions: number;
  bannedWords: string[];
  bannedClaims: string[];
}

const SPAM_TRIGGERS = [
  "act now",
  "limited time",
  "risk-free",
  "risk free",
  "no obligation",
  "click here",
  "100% free",
  "guarantee",
  "buy now",
  "special promotion",
  "once in a lifetime",
];

const AI_TELLS = ["i hope this email finds you well", "in today's fast-paced", "delve", "unlock the power", "seamlessly", "elevate your"];

export function parseRules(rulesMd: string): CopyRules {
  const kv = keyValues(rulesMd, /first email/i);
  const num = (v: string | undefined, d: number) => {
    const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxWords: num(kv.max_words, 90),
    allowLinks: !/^(no|false|none|0)$/i.test(kv.links ?? "no"),
    maxQuestions: num(kv.max_questions, 1),
    bannedWords: bullets(rulesMd, /banned words/i).map((s) => s.toLowerCase()),
    bannedClaims: bullets(rulesMd, /banned claims/i).map((s) => s.toLowerCase()),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function countWords(text: string): number {
  return (text.trim().match(/[A-Za-z0-9'’$%.-]+/g) ?? []).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Deterministic checks. The same rules.md gives the same result in every agent. */
export function lintCopy(text: string, rules: CopyRules): LintResult {
  const issues: LintIssue[] = [];
  const lower = text.toLowerCase();
  const words = countWords(text);
  if (words > rules.maxWords) {
    issues.push({ rule: "max_words", severity: "error", message: `${words} words. The limit is ${rules.maxWords}.` });
  }
  if (!rules.allowLinks) {
    const link = /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|io|ai|co|net|org)\/\S*)/i.exec(text);
    if (link) issues.push({ rule: "links", severity: "error", message: "Links are not allowed in a first email.", match: link[0] });
  }
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > rules.maxQuestions) {
    issues.push({ rule: "max_questions", severity: "warning", message: `${questions} questions. Keep it to ${rules.maxQuestions}.` });
  }
  for (const w of rules.bannedWords) {
    // Single long words also catch their forms: "leverage" -> leveraged, leveraging. Phrases match exactly.
    const single = /^[a-z]+$/i.test(w) && w.length >= 6;
    const stem = single ? escapeRe(w.replace(/e$/i, "")) + "[a-z]*" : escapeRe(w);
    if (new RegExp(`(^|[^a-z])${stem}([^a-z]|$)`, "i").test(lower)) {
      issues.push({ rule: "banned_word", severity: "error", message: `Banned word: "${w}"`, match: w });
    }
  }
  for (const c of rules.bannedClaims) {
    if (c && lower.includes(c)) issues.push({ rule: "banned_claim", severity: "error", message: `Banned claim: "${c}"`, match: c });
  }
  for (const s of SPAM_TRIGGERS) {
    if (lower.includes(s)) issues.push({ rule: "spam_trigger", severity: "warning", message: `Spam-filter trigger: "${s}"`, match: s });
  }
  for (const s of AI_TELLS) {
    if (lower.includes(s)) issues.push({ rule: "ai_tell", severity: "warning", message: `Reads as AI-written: "${s}"`, match: s });
  }
  if (/!/.test(text)) issues.push({ rule: "exclamation", severity: "warning", message: "Exclamation marks read as salesy." });
  const caps = text.match(/\b[A-Z]{4,}\b/g)?.filter((w) => !/^(SaaS|CRM|API|B2B|SDR|BDR|ICP|ROI|GTM|CEO|CTO|CFO|COO|CMO|CRO|HTTP|SOC|ISO|GDPR|HIPAA|AWS|ARR|MRR|SMB|ABM)$/i.test(w));
  if (caps?.length) issues.push({ rule: "all_caps", severity: "warning", message: `All-caps words: ${caps.join(", ")}` });
  if (/\{\{|\}\}|\[[a-z][^\]]*\]/i.test(text)) {
    issues.push({ rule: "placeholder", severity: "error", message: "Unfilled placeholder left in the copy." });
  }
  if (/\bnot found\b/i.test(text)) {
    issues.push({ rule: "unresolved_fact", severity: "error", message: 'Copy contains "not found": a fact could not be confirmed.' });
  }
  if (/^\s*(hi [^,\n]+,\s*)?(i am|i'm|my name is)\b/i.test(text)) {
    issues.push({ rule: "self_opener", severity: "warning", message: "Opens with yourself. Open with the buyer's situation." });
  }
  return { ok: !issues.some((i) => i.severity === "error"), words, issues };
}
