/** Starter files for a new client brain. Brackets are placeholders the health check flags. */

export function agentsMd(name: string): string {
  return `# GTM brain: ${name}
We are [company]. We sell [product] to [who].

Before any GTM task:
1. Read icp.md, offers.md and rules.md.
2. Check past-campaigns/ for what worked with this audience.
3. Use the files in products/ for every product fact.

Rules for every agent:
- Never invent a fact, a number, a name or a quote. Write "not found".
- Never use a claim that rules.md bans.
- Keep every campaign in draft until a person approves it.
- After a campaign, write its results to past-campaigns/ (use the close-campaign skill).
- Change icp.md, offers.md, rules.md or products/ only through a proposal. The brain owner approves it.
`;
}

export const ICP_TEMPLATE = `# ICP

_Not built yet. Export closed-won and closed-lost deals to data/ and run build_icp._

## Sources
1. Closed-won CRM data (highest priority)
2. Closed-lost CRM data
3. Call notes
`;

export const OFFERS_TEMPLATE = `# Offers

## What we sell
- [offer name]: [one-line description]

## Pricing
- [price or pricing model]

## Proof we can use
<!-- Only results a customer agreed we can name. One per line. -->
- [customer] [result with a number]

## Calls to action
- [a useful, low-friction offer, e.g. a teardown, a benchmark, a sample list]
`;

export const RULES_TEMPLATE = `# Rules

## First email
- max_words: 90
- links: no
- max_questions: 1
- format: plain text

## Banned words
- synergy
- leverage
- revolutionary
- game-changer
- cutting-edge
- best-in-class
- touch base
- circle back

## Banned claims
- guaranteed results
- #1 in the market
- 10x your pipeline

## Voice
- Write like a peer, not a vendor.
- One idea per email.
- Name a fact the buyer can check.
`;

export const PRODUCT_TEMPLATE = (name: string) => `# ${name}

## What it does
- [feature]: [what it does for the buyer]

## Facts we can state
- [fact with a number]

## Who it is for
- [role] at [company type]
`;

export const README_FOLDERS: Record<string, string> = {
  "products/.keep": "",
  "past-campaigns/.keep": "",
  "call-notes/.keep": "",
  "data/.keep": "",
};
