import { mulberry32, round, sampleBeta, wilson } from "./stats";

export interface CampaignStat {
  segment: string;
  angle?: string | null;
  sent: number;
  replies: number;
  positive: number;
  meetings: number;
}

export interface SegmentPosterior {
  segment: string;
  sent: number;
  positive: number;
  replies: number;
  meetings: number;
  positiveRate: number;
  replyRate: number;
  /** Posterior mean of the positive-reply rate (Beta(1+pos, 1+sent-pos)). */
  expected: number;
  interval: [number, number];
  /** Probability this segment has the highest true positive rate (Thompson sampling). */
  pBest: number;
  campaigns: number;
}

export interface Recommendation {
  segment: string;
  action: "scale" | "test more" | "explore" | "stop";
  why: string;
  pBest: number;
  expected: number;
}

/** Aggregate campaigns by segment (or angle) and compute Bayesian posteriors. */
export function segmentPosteriors(stats: CampaignStat[], by: "segment" | "angle" = "segment", draws = 4000): SegmentPosterior[] {
  const groups = new Map<string, { sent: number; positive: number; replies: number; meetings: number; campaigns: number }>();
  for (const s of stats) {
    const key = (by === "segment" ? s.segment : s.angle) || "unlabelled";
    const g = groups.get(key) ?? { sent: 0, positive: 0, replies: 0, meetings: 0, campaigns: 0 };
    g.sent += s.sent;
    g.positive += Math.min(s.positive, s.sent);
    g.replies += Math.min(s.replies, s.sent);
    g.meetings += s.meetings;
    g.campaigns++;
    groups.set(key, g);
  }
  const keys = [...groups.keys()];
  const wins = new Map(keys.map((k) => [k, 0]));
  const rand = mulberry32(42);
  for (let i = 0; i < draws; i++) {
    let bestK = "";
    let bestV = -1;
    for (const k of keys) {
      const g = groups.get(k)!;
      const v = sampleBeta(1 + g.positive, 1 + Math.max(0, g.sent - g.positive), rand);
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    wins.set(bestK, (wins.get(bestK) ?? 0) + 1);
  }
  return keys
    .map((k) => {
      const g = groups.get(k)!;
      return {
        segment: k,
        sent: g.sent,
        positive: g.positive,
        replies: g.replies,
        meetings: g.meetings,
        positiveRate: round(g.sent ? g.positive / g.sent : 0, 4),
        replyRate: round(g.sent ? g.replies / g.sent : 0, 4),
        expected: round((1 + g.positive) / (2 + g.sent), 4),
        interval: wilson(g.positive, g.sent).map((x) => round(x, 4)) as [number, number],
        pBest: round((wins.get(k) ?? 0) / draws, 3),
        campaigns: g.campaigns,
      };
    })
    .sort((a, b) => b.pBest - a.pBest || b.expected - a.expected);
}

/**
 * Next 3 segments: exploit the likely winner, keep testing close contenders,
 * and flag segments with enough volume and a clearly worse rate to stop.
 */
export function recommendSegments(posteriors: SegmentPosterior[], untested: string[] = []): Recommendation[] {
  const recs: Recommendation[] = [];
  const top = posteriors[0];
  for (const p of posteriors) {
    const pctStr = `${round(p.positiveRate * 100, 1)}% positive (${p.positive}/${p.sent})`;
    if (p === top && p.pBest >= 0.5 && p.sent >= 100) {
      recs.push({ segment: p.segment, action: "scale", why: `${pctStr}; ${round(p.pBest * 100)}% chance it is the best segment.`, pBest: p.pBest, expected: p.expected });
    } else if (p.sent < 150 || p.pBest >= 0.15) {
      recs.push({ segment: p.segment, action: "test more", why: `${pctStr}; not enough volume to call it yet (${round(p.pBest * 100)}% chance best).`, pBest: p.pBest, expected: p.expected });
    } else if (top && p.interval[1] < top.interval[0]) {
      recs.push({ segment: p.segment, action: "stop", why: `${pctStr}; clearly below ${top.segment}.`, pBest: p.pBest, expected: p.expected });
    }
  }
  for (const u of untested.slice(0, 3)) {
    recs.push({ segment: u, action: "explore", why: "Matches the ICP but has never been tested.", pBest: 0, expected: 0 });
  }
  const order = { scale: 0, "test more": 1, explore: 2, stop: 3 };
  return recs.sort((a, b) => order[a.action] - order[b.action] || b.pBest - a.pBest);
}
