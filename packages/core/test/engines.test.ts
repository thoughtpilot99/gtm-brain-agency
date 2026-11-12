import { describe, expect, it } from "vitest";
import {
  buildIcpModel,
  scoreAccount,
  signalStrength,
  lintCopy,
  parseRules,
  verifyClaims,
  segmentPosteriors,
  recommendSegments,
  diffLines,
  twoProportionZ,
  normalCdf,
  parseCsv,
  toCsv,
  sizeBucket,
  seniorityOf,
  functionOf,
  RULES_TEMPLATE,
  type DealRow,
  type Account,
  templateDraft,
  buildSources,
  isFreshSignal,
  type WriterContext,
} from "../src/index";

const deal = (outcome: "won" | "lost", industry: string, employees: number, tech: string[], title = "VP of Sales"): DealRow => ({
  company: "x",
  domain: `${Math.random()}.com`,
  industry,
  employees,
  region: "North America",
  tech,
  signerTitle: title,
  outcome,
});

describe("stats", () => {
  it("normal CDF matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
  it("two-proportion z is positive when the first share is higher", () => {
    expect(twoProportionZ(30, 50, 10, 50)).toBeGreaterThan(3);
    expect(twoProportionZ(10, 50, 10, 50)).toBe(0);
  });
});

describe("traits", () => {
  it("buckets sizes and titles", () => {
    expect(sizeBucket(120)).toBe("51-200");
    expect(sizeBucket(0)).toBeUndefined();
    expect(seniorityOf("VP of Sales")).toBe("VP");
    expect(seniorityOf("Head of Revenue Operations")).toBe("Head/Director");
    expect(functionOf("Head of Revenue Operations")).toBe("RevOps");
    expect(functionOf("Sales Manager")).toBe("Sales");
  });
});

describe("ICP lift", () => {
  const deals: DealRow[] = [
    ...Array.from({ length: 30 }, () => deal("won", "B2B SaaS", 120, ["HubSpot"])),
    ...Array.from({ length: 5 }, () => deal("won", "Fintech", 900, [])),
    ...Array.from({ length: 8 }, () => deal("lost", "B2B SaaS", 20, ["Pipedrive"], "Sales Manager")),
    ...Array.from({ length: 22 }, () => deal("lost", "E-commerce", 20, ["Pipedrive"], "Sales Manager")),
  ];
  const model = buildIcpModel(deals);

  it("marks over-represented traits as core with high confidence", () => {
    const saas = model.traits.find((t) => t.dimension === "industry" && t.value === "B2B SaaS")!;
    expect(saas.won).toBe(30);
    expect(saas.lost).toBe(8);
    expect(saas.verdict).toBe("core");
    expect(saas.lift).toBeGreaterThan(2);
    const hubspot = model.traits.find((t) => t.value === "HubSpot")!;
    expect(hubspot.verdict).toBe("core");
  });

  it("marks traits common in losses as negative", () => {
    const pipedrive = model.traits.find((t) => t.value === "Pipedrive")!;
    expect(pipedrive.verdict).toBe("negative");
    expect(pipedrive.weight).toBeLessThan(0);
  });

  it("keeps lifts finite for traits never seen in losses (smoothing)", () => {
    const fintech = model.traits.find((t) => t.value === "Fintech")!;
    expect(Number.isFinite(fintech.lift)).toBe(true);
    expect(fintech.lift).toBeLessThan(10);
  });

  it("warns when the sample is small", () => {
    expect(buildIcpModel(deals.slice(0, 5)).warnings.length).toBeGreaterThan(0);
  });
});

describe("account scoring", () => {
  const model = buildIcpModel([
    ...Array.from({ length: 30 }, () => deal("won", "B2B SaaS", 120, ["HubSpot"])),
    ...Array.from({ length: 30 }, () => deal("lost", "E-commerce", 20, ["Pipedrive"])),
  ]);
  const base: Account = { client: "t", domain: "a.com", name: "A", industry: "B2B SaaS", employees: 150, region: "North America", tech: ["HubSpot"], signals: [], reasons: [] };

  it("gives full fit to a perfect ICP match and explains why", () => {
    const s = scoreAccount(base, model, null);
    expect(s.fit).toBeGreaterThan(50);
    expect(s.reasons.some((r) => r.includes("B2B SaaS"))).toBe(true);
  });

  it("adds decayed intent from fresh signals and promotes the tier", () => {
    const fresh = scoreAccount({ ...base, signals: [{ type: "funding", title: "Raised Series B", date: new Date().toISOString(), source: "t" }] }, model, null);
    const stale = scoreAccount({ ...base, signals: [{ type: "funding", title: "Raised Series B", date: new Date(Date.now() - 400 * 86_400_000).toISOString(), source: "t" }] }, model, null);
    expect(fresh.intent).toBeGreaterThan(stale.intent);
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("halves signal strength after one half-life", () => {
    const at = new Date();
    const s = signalStrength({ type: "hiring", title: "x", date: new Date(at.getTime() - 30 * 86_400_000).toISOString(), source: "t" }, at);
    expect(s).toBeCloseTo(11, 0);
  });

  it("suppresses customers regardless of score", () => {
    const s = scoreAccount(base, model, "existing customer");
    expect(s.tier).toBe("Suppressed");
    expect(s.reasons[0]).toContain("existing customer");
  });

  it("caps intent at 40", () => {
    const signals = Array.from({ length: 12 }, () => ({ type: "funding" as const, title: "x", date: new Date().toISOString(), source: "t" }));
    expect(scoreAccount({ ...base, signals }, model, null).intent).toBeLessThanOrEqual(40);
  });
});

describe("rules lint", () => {
  const rules = parseRules(RULES_TEMPLATE);
  it("parses rules.md", () => {
    expect(rules.maxWords).toBe(90);
    expect(rules.allowLinks).toBe(false);
    expect(rules.bannedWords).toContain("synergy");
  });
  it("flags links, banned words, length and placeholders", () => {
    const long = Array.from({ length: 95 }, () => "word").join(" ");
    const r = lintCopy(`${long} see https://x.com/a for synergy [company]`, rules);
    const ids = r.issues.map((i) => i.rule);
    expect(ids).toEqual(expect.arrayContaining(["max_words", "links", "banned_word", "placeholder"]));
    expect(r.ok).toBe(false);
  });
  it("passes clean copy", () => {
    const r = lintCopy("Saw you are hiring two SDRs. Teams like yours usually lose a month to list building. Worth a short teardown?", rules);
    expect(r.ok).toBe(true);
  });
  it("does not flag words that merely contain a banned word", () => {
    expect(lintCopy("Leveraged buyouts aside, quick note.", { ...rules, bannedWords: ["leverage"] }).issues.some((i) => i.rule === "banned_word")).toBe(true);
    expect(lintCopy("Releverage nothing.", { ...rules, bannedWords: ["leverage"] }).issues.some((i) => i.rule === "banned_word")).toBe(false);
  });
});

describe("claim ledger", () => {
  const sources = [
    { id: "S1", kind: "signal" as const, text: "Hiring: Account Executive (2026-11-01, via apollo)" },
    { id: "O1", kind: "proof" as const, text: "Onyx Cloud booked 41 meetings in 60 days" },
  ];
  it("accepts facts whose numbers and names are in the cited source", () => {
    const [c] = verifyClaims([{ text: "Onyx Cloud booked 41 meetings in 60 days.", kind: "fact", sources: ["O1"] }], sources, { allowedNames: [] });
    expect(c.supported).toBe(true);
  });
  it("blocks invented numbers", () => {
    const [c] = verifyClaims([{ text: "Onyx Cloud booked 75 meetings in 60 days.", kind: "fact", sources: ["O1"] }], sources, { allowedNames: [] });
    expect(c.supported).toBe(false);
    expect(c.problems.join()).toContain("75");
  });
  it("blocks facts with no source and invented names", () => {
    const [a, b] = verifyClaims(
      [
        { text: "You just raised money.", kind: "fact", sources: [] },
        { text: "Teams like Zentrix see more replies.", kind: "opinion", sources: [] },
      ],
      sources,
      { allowedNames: [] },
    );
    expect(a.supported).toBe(false);
    expect(b.supported).toBe(false);
  });
  it("blocks citations of sources that do not exist", () => {
    const [c] = verifyClaims([{ text: "Saw the news.", kind: "fact", sources: ["S9"] }], sources, { allowedNames: [] });
    expect(c.problems[0]).toContain("unknown source");
  });
});

describe("campaign learning", () => {
  it("ranks the segment with the higher positive rate as most likely best", () => {
    const p = segmentPosteriors([
      { segment: "A", sent: 400, replies: 40, positive: 28, meetings: 10 },
      { segment: "B", sent: 400, replies: 20, positive: 6, meetings: 2 },
    ]);
    expect(p[0].segment).toBe("A");
    expect(p[0].pBest).toBeGreaterThan(0.95);
    const rec = recommendSegments(p, ["C"]);
    expect(rec.find((r) => r.segment === "A")?.action).toBe("scale");
    expect(rec.find((r) => r.segment === "B")?.action).toBe("stop");
    expect(rec.find((r) => r.segment === "C")?.action).toBe("explore");
  });
  it("asks for more data when volume is low", () => {
    const p = segmentPosteriors([
      { segment: "A", sent: 30, replies: 3, positive: 2, meetings: 1 },
      { segment: "B", sent: 25, replies: 2, positive: 1, meetings: 0 },
    ]);
    expect(recommendSegments(p).every((r) => r.action === "test more")).toBe(true);
  });
});

describe("csv and diff", () => {
  it("round-trips quoted CSV", () => {
    const rows = [{ a: 'x, "y"', b: "line1\nline2" }];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("diffs lines", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(d.filter((x) => x.op === "add").map((x) => x.text)).toEqual(["B", "d"]);
    expect(d.filter((x) => x.op === "del").map((x) => x.text)).toEqual(["b"]);
  });
});

describe("signal freshness in the writer", () => {
  const acct = (date: string): Account => ({
    client: "t",
    domain: "a.com",
    name: "Acme",
    tech: [],
    reasons: [],
    signals: [{ type: "funding", title: "Raised Series A", date, source: "t" }],
  });
  const ctxOf = (account: Account): WriterContext => ({ account, clientName: "Us", offersMd: "", productsMd: [], callNotesMd: [], icpSummary: [], voice: [], rules: parseRules(RULES_TEMPLATE) });
  it("opens with a fresh signal", () => {
    const a = acct(new Date(Date.now() - 20 * 86_400_000).toISOString());
    const d = templateDraft(ctxOf(a), buildSources(ctxOf(a)));
    expect(d.sentences.map((s) => s.text).join(" ")).toMatch(/Saw Acme raised Series A/);
  });
  it("never presents a two-year-old round as news", () => {
    const a = acct("2024-10-21T00:00:00.000Z");
    const ctx = ctxOf(a);
    const src = buildSources(ctx);
    expect(src.find((s) => s.id === "S1")?.text).toMatch(/OLD: background only/);
    expect(templateDraft(ctx, src).sentences.map((s) => s.text).join(" ")).not.toMatch(/raised/i);
    expect(isFreshSignal({ type: "hiring", date: new Date().toISOString() })).toBe(true);
  });
});

describe("matching CRM labels to provider data", () => {
  it("maps CRM industry labels onto vendor industries and descriptions", async () => {
    const { industryMatches, techKey } = await import("../src/traits");
    expect(industryMatches("B2B SaaS", "Software Development")).toBe("industry");
    expect(industryMatches("Cybersecurity", "Computer and Network Security")).toBe("industry");
    expect(industryMatches("DevTools", "Technology; Information and Internet", "An API platform for developers")).toBe("description");
    expect(industryMatches("Healthcare IT", "Software Development")).toBeNull();
    expect(industryMatches("Marketing", "Advertising Services")).toBe("industry");
    expect(techKey("Gong.io")).toBe(techKey("Gong"));
    expect(techKey("HubSpot CRM")).toBe(techKey("Hubspot"));
  });

  it("scores a vendor-labelled account against a CRM-labelled ICP, and lets a bad fit win", () => {
    const won = [...Array(12)].map(() => deal("won", "B2B SaaS", 150, ["Gong"]));
    const lost = [...Array(12)].map(() => deal("lost", "Marketing", 150, ["Pipedrive"]));
    const model = buildIcpModel([...won, ...lost]);
    const base: Account = { client: "t", domain: "x.com", name: "X", employees: 150, region: "North America", tech: ["Gong.io"], signals: [], reasons: [] };
    const saas = scoreAccount({ ...base, industry: "Software Development" }, model, null);
    const agency = scoreAccount({ ...base, industry: "Marketing Services", description: "A B2B SaaS marketing agency" }, model, null);
    expect(saas.reasons.join(" ")).toMatch(/B2B SaaS \(via Software Development/);
    expect(saas.reasons.join(" ")).toMatch(/Gong\.io/);
    expect(agency.fit).toBeLessThan(saas.fit);
  });
});

describe("template writer polish", () => {
  it("cleans roles, picks the right article and counts go-to-market hires", async () => {
    const { cleanRole, withArticle, openGtmRoles } = await import("../src/engines/writer");
    const { displayName } = await import("../src/providers/coldiq");
    expect(cleanRole("Hiring: Regional Sales Director, NEUR")).toBe("Regional Sales Director");
    expect(cleanRole("Hiring: Account Executive - Media Sales (DTC)")).toBe("Account Executive");
    expect(withArticle("Account Executive")).toBe("an Account Executive");
    expect(withArticle("Sales Director")).toBe("a Sales Director");
    const now = new Date().toISOString();
    const roles = openGtmRoles([
      { type: "hiring", title: "Hiring: Regional Sales Director, NEUR", date: now, source: "t" },
      { type: "hiring", title: "Hiring: Account Executive, Mexico City", date: now, source: "t" },
      { type: "hiring", title: "Hiring: Account Executive, Sao Paolo", date: now, source: "t" },
      { type: "hiring", title: "Hiring: Backend Engineer", date: now, source: "t" },
    ]);
    expect(roles).toEqual(["Regional Sales Director", "Account Executive"]);
    expect(displayName("Horizon3.Ai", "horizon3.ai")).toBe("Horizon3.ai");
    expect(displayName("Coalition, Inc.", "coalitioninc.com")).toBe("Coalition");
  });

  it("writes a verified 'N go-to-market roles' line", () => {
    const now = Date.now();
    const a: Account = {
      client: "t",
      domain: "h3.example",
      name: "Hthree",
      tech: [],
      reasons: [],
      signals: [
        { type: "hiring", title: "Hiring: Regional Sales Director, NEUR", date: new Date(now).toISOString(), source: "t" },
        { type: "hiring", title: "Hiring: Account Executive, Mexico City", date: new Date(now - 86_400_000).toISOString(), source: "t" },
      ],
    };
    const ctx: WriterContext = { account: a, clientName: "Us", offersMd: "", productsMd: [], callNotesMd: [], icpSummary: [], voice: [], rules: parseRules(RULES_TEMPLATE) };
    const src = buildSources(ctx);
    const d = templateDraft(ctx, src);
    const line = d.sentences.find((s) => s.kind === "fact")!;
    expect(line.text).toBe("Saw Hthree has 2 go-to-market roles open, including a Regional Sales Director.");
    expect(verifyClaims(d.sentences, src, { allowedNames: ["Us"] }).every((c) => c.supported)).toBe(true);
  });
});
