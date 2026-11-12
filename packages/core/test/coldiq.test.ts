import { afterEach, describe, expect, it, vi } from "vitest";
import { coldiqProvider, countryName, employeeSpan, mapColdiqStatus, toCompany, toCountryCodes } from "../src/providers/coldiq";

// Shapes copied from live ColdIQ responses (Nov 2026), with made-up companies and people.
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("ColdIQ mapping", () => {
  it("maps ICP locations and size ranges to ColdIQ filters", () => {
    expect(toCountryCodes(["United States", "Canada", "Europe"]).slice(0, 3)).toEqual(["US", "CA", "DE"]);
    expect(toCountryCodes(["North America", "gb"])).toEqual(["US", "CA", "GB"]);
    expect(employeeSpan(["11,50", "51,200"])).toEqual({ min_employees: 11, max_employees: 200 });
    expect(employeeSpan([])).toEqual({});
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("Germany")).toBe("Germany");
  });

  it("maps finder and verifier statuses", () => {
    expect(mapColdiqStatus("valid", "verified")).toBe("verified");
    expect(mapColdiqStatus("deliverable")).toBe("verified");
    expect(mapColdiqStatus("catch_all")).toBe("catch_all");
    expect(mapColdiqStatus("invalid")).toBe("invalid");
    expect(mapColdiqStatus("unknown")).toBe("risky");
    expect(mapColdiqStatus(undefined)).toBe("unverified");
  });

  it("turns an enrich record into a company with funding and tech", () => {
    const c = toCompany({
      name: "Fieldnote",
      domain: "fieldnote.example",
      employees: 44,
      industry: "Software Development",
      country: "US",
      company_data: { company_id: "123", company_funding: { last_round_type: "SERIES_A", last_round_date: "2026-08-01" } },
      company_detected_technologies: [{ technology_product: { name: "HubSpot" } }, { technology_product: {} }],
    });
    expect(c).toMatchObject({ domain: "fieldnote.example", employees: 44, country: "United States", region: "North America", tech: ["HubSpot"], fundingStage: "SERIES_A", source: "coldiq" });
  });
});

describe("ColdIQ provider over HTTP", () => {
  it("sends the key and a User-Agent, and reports the real charge", async () => {
    const fetchMock = vi.fn(async () =>
      reply({
        data: { companies: [{ name: "Fieldnote", domain: "fieldnote.example", employees: 40, country: "US" }], has_more: false },
        _meta: { provider: "coldiq", credits_charged: 0.093 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const p = coldiqProvider("ciq_test_key");
    const res = await p.searchCompanies!({ industries: ["B2B SaaS"], employeeRanges: ["11,200"], locations: ["United States"], limit: 3, page: 1 });
    expect(res.map((c) => c.domain)).toEqual(["fieldnote.example"]);
    expect(p.takeCharge()).toBeCloseTo(0.093);
    expect(p.takeCharge()).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.coldiq.com/v1/companies/search");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer ciq_test_key");
    expect(h["User-Agent"]).toMatch(/gtm-brain/);
    const body = JSON.parse(String(init.body));
    expect(body.input).toMatchObject({ keywords: ["B2B SaaS"], countries: ["US"], min_employees: 11, max_employees: 200, limit: 3, page: 0 });
  });

  it("returns a verified email from the finder and treats a soft miss as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(reply({ data: { work_email: "dana@fieldnote.example", email_status: "valid", verification: "verified" }, _meta: { credits_charged: 1.022 } }))
        .mockResolvedValueOnce(reply({ found: false, verdict: "not_found", providers_tried: 4 })),
    );
    const p = coldiqProvider("k");
    expect(await p.findEmail!({ firstName: "Dana", lastName: "Reyes", domain: "fieldnote.example" })).toEqual({ email: "dana@fieldnote.example", status: "verified" });
    expect(await p.findEmail!({ firstName: "No", lastName: "One", domain: "fieldnote.example" })).toEqual({ email: null });
  });

  it("only offers hiring signals when they are switched on", () => {
    expect(coldiqProvider("k").jobPostings).toBeUndefined();
    expect(typeof coldiqProvider("k", { hiringSignals: true }).jobPostings).toBe("function");
  });

  it("explains an out-of-credits error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: "insufficient credits" }, 402)));
    await expect(coldiqProvider("k").enrichCompany!("fieldnote.example")).rejects.toThrow(/out of credits/);
  });
});

describe("ColdIQ verbose search records", () => {
  it("reads the latest primary round, useful tech and HQ from an AI Ark record", async () => {
    const { arkToCompany, fundingTitle } = await import("../src/providers/coldiq");
    const c = arkToCompany({
      id: "x1",
      summary: { name: "Shieldline", industry: "computer and network security", staff: { total: 420 }, overview: "Secures factories." },
      link: { domain: "shieldline.example", linkedin: "https://www.linkedin.com/company/shieldline" },
      location: { headquarter: { country: "United States" } },
      technologies: [{ name: "hubspot", category: "crm" }, { name: "cloudflare", category: "cdn" }],
      financial: {
        funding: {
          type: "SERIES_F",
          rounds: [
            { announced_at: "2026-01-22", raised_amount: 50_000_000, type: "SECONDARY_MARKET" },
            { announced_at: "2026-01-22", raised_amount: 150_000_000, type: "SERIES_F" },
            { announced_at: "2024-06-04", type: "VENTURE_ROUND" },
          ],
        },
      },
    })!;
    expect(c).toMatchObject({ domain: "shieldline.example", employees: 420, region: "North America", tech: ["Hubspot"], fundingStage: "SERIES_F", lastFundingDate: "2026-01-22", lastFundingAmount: 150_000_000 });
    expect(fundingTitle("SERIES_F", 150_000_000)).toBe("Raised a $150M Series F");
    expect(fundingTitle("series unknown")).toBe("Raised a funding round");
    expect(fundingTitle("VENTURE_ROUND", 8_500_000)).toBe("Raised $8.5M");
  });

  it("keeps only the latest funding round when signals merge", async () => {
    const { mergeSignals } = await import("../src/providers/gateway");
    const fresh = { type: "funding" as const, title: "Raised a $150M Series F", date: "2026-01-22T00:00:00.000Z", source: "coldiq" };
    const stale = { type: "funding" as const, title: "Raised a funding round", date: "2024-06-04T00:00:00.000Z", source: "coldiq" };
    const hire = { type: "hiring" as const, title: "Hiring: AE", date: "2026-10-01T00:00:00.000Z", source: "coldiq" };
    const { signals } = mergeSignals([fresh, hire], [stale]);
    expect(signals.map((s) => s.title)).toEqual(["Hiring: AE", "Raised a $150M Series F"]);
  });
});
