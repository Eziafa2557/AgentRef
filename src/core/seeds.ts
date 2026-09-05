import type { ChallengeInput } from "./challenge";
import { createReceipt } from "./receipt";
import type { Receipt } from "./types";

/**
 * Seed scenarios — realistic *starting points* only. Every seed is a normal
 * receipt: it can be challenged with arbitrary user input, or with the bundled
 * suggested challenge for a ~60-90s judge walkthrough. The app never forces a
 * scripted story.
 */

export interface SeedScenario {
  seedId: string;
  title: string;
  briefTitle: string;
  brief: string;
  requirements: string[];
  riskRequirements: string[];
  agentName: string;
  requesterName: string;
  workTitle: string;
  work: string;
  paymentAmountUsd: number;
  suggested: ChallengeInput;
}

export const DEMO_SEEDS: SeedScenario[] = [
  {
    seedId: "seed-pass",
    title: "Passes the brief",
    briefTitle: "Six-month ETH holding analysis",
    brief:
      "Analyze ETH for a six-month holding period. Compare the upside and downside risks, and clearly disclose the major risks.",
    requirements: [
      "Analyze ETH for a six-month holding period.",
      "Compare the upside and downside risks.",
      "Clearly disclose the major risks.",
    ],
    riskRequirements: [],
    agentName: "Solis Research",
    requesterName: "Arcadia Capital",
    workTitle: "ETH holding memo (six months)",
    work:
      "ETH has solid six-month momentum. Upside: staking yield, L2 ecosystem growth and steady institutional inflows. Downside risk: high volatility — a major price drawdown of 30-40% is possible, plus regulatory uncertainty. Net view: hold ETH for the six-month window.",
    paymentAmountUsd: 5000,
    suggested: {
      reason:
        "The buyer disputes that the deliverable actually compared downside risk — we allege the analysis was one-sided and the 'disclose the major risks' requirement was not genuinely met.",
      violatedRequirements: ["Clearly disclose the major risks."],
      missedRiskRequirements: [],
      additionalContext:
        "The downside paragraph reads more like boilerplate than an honest comparison of material risks for a six-month hold.",
      challengerName: "Arcadia Compliance (demo)",
      evidence: [
        {
          label: "Disputed memo excerpt",
          content:
            "Downside risk: high volatility — a major price drawdown of 30-40% is possible, plus regulatory uncertainty.",
        },
      ],
    },
  },
  {
    seedId: "seed-fail",
    title: "Violates an explicit rule",
    briefTitle: "Risk-averse ETH recommendation",
    brief:
      "Analyze ETH for a six-month holding period. The client is risk-averse. Do not recommend leverage or derivatives of any kind.",
    requirements: [
      "Analyze ETH for a six-month holding period.",
      "Do not recommend leverage or derivatives of any kind.",
    ],
    riskRequirements: [],
    agentName: "Apex Quant Desk",
    requesterName: "Meridian Family Office",
    workTitle: "ETH six-month trade idea",
    work:
      "ETH is a solid six-month hold, but to actually maximise returns we recommend opening a 3x leveraged long via ETHUSDT perpetual futures. The leverage is what makes this trade worth doing.",
    paymentAmountUsd: 8000,
    suggested: {
      reason:
        "The submitted advice recommends a leveraged ETH futures position, which directly violates the brief's explicit instruction not to recommend leverage or derivatives for a risk-averse client.",
      violatedRequirements: ["Do not recommend leverage or derivatives of any kind."],
      missedRiskRequirements: [],
      additionalContext:
        "The recommendation is the centerpiece of the deliverable, not a passing mention — the agent knowingly advised a derivative for a risk-averse client.",
      challengerName: "Meridian Risk (demo)",
      evidence: [
        {
          label: "Trade idea — recommendation section",
          content:
            "to actually maximise returns we recommend opening a 3x leveraged long via ETHUSDT perpetual futures.",
        },
      ],
    },
  },
  {
    seedId: "seed-material-risk",
    title: "Misses a required material risk",
    briefTitle: "BTC allocation for a conservative client",
    brief:
      "Allocate $50,000 to Bitcoin for a conservative client. Give a clear recommendation, and clearly disclose the major downside risks of the strategy.",
    requirements: ["Give a clear recommendation on the BTC allocation."],
    riskRequirements: ["Clearly disclose the major downside risks of the strategy."],
    agentName: "Northstar Advisors",
    requesterName: "Hawthorne Private Trust",
    workTitle: "BTC allocation recommendation",
    work:
      "A reasonable allocation is $50,000 to Bitcoin, roughly one-fifth of the portfolio. Bitcoin has the strongest long-term record of any crypto asset, benefits from growing institutional adoption and a fixed supply, and has historically rewarded patient holders. We are confident in this recommendation for the stated time horizon.",
    paymentAmountUsd: 3000,
    suggested: {
      reason:
        "The brief required clear disclosure of the major downside risks of a BTC allocation for a conservative client. The advice never mentions a material downside risk — a near-total omission for this investor profile.",
      violatedRequirements: [],
      missedRiskRequirements: ["Clearly disclose the major downside risks of the strategy."],
      additionalContext:
        "For a conservative client, halving risk, drawdowns and permanent-loss scenarios were required reading. The memo is one-sided.",
      challengerName: "Hawthorne Trustee (demo)",
      evidence: [
        {
          label: "Advice email",
          content:
            "A reasonable allocation is $50,000 to Bitcoin, roughly one-fifth of the portfolio. Bitcoin has the strongest long-term record of any crypto asset…",
        },
      ],
    },
  },
];

/** Build the three seed receipts (fresh — no challenge attached). */
export function buildDemoReceipts(): Receipt[] {
  return DEMO_SEEDS.map((s) =>
    createReceipt({
      briefTitle: s.briefTitle,
      brief: s.brief,
      requirements: s.requirements,
      riskRequirements: s.riskRequirements,
      agentName: s.agentName,
      requesterName: s.requesterName,
      workTitle: s.workTitle,
      work: s.work,
      paymentAmountUsd: s.paymentAmountUsd,
      paymentAsset: "USDC",
      createdBy: "demo",
      seedId: s.seedId,
    })
  );
}

export function suggestedChallengeFor(seedId: string): ChallengeInput | null {
  const s = DEMO_SEEDS.find((x) => x.seedId === seedId);
  return s ? s.suggested : null;
}
