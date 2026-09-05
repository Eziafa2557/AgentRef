/**
 * SIMULATED adjudicator (local, deterministic).
 *
 * IMPORTANT — honesty boundary: this module performs NO GenLayer verification.
 * It is a transparent, rule-based stand-in so the full product flow can be
 * exercised without a network or credentials. Every ruling it produces is
 * tagged `source: "simulated"` and the UI always labels it "SIMULATED —
 * validators were not consulted". The real path is the GenLayer Intelligent
 * Contract in genlayer/contract.py, reached through src/core/genlayer.
 *
 * The logic is deliberately inspectable: it checks each explicit requirement
 * and each material-risk requirement against the submitted work with simple
 * language rules, and it reports exactly what it looked for — so a viewer can
 * judge the judgment.
 */
import type { Receipt, Ruling, Verdict } from "./types";

export const RISK_LEXICON = [
  "downside",
  "risk",
  "loss",
  "loses",
  "losses",
  "volatility",
  "volatile",
  "crash",
  "drawdown",
  "decline",
  "drop",
  "liquidat",
  "bear",
  "recession",
  "correction",
  "uncertainty",
  "exposure",
  "wiped",
  "impair",
];

const STOP = new Set(
  (
    "the a an and or but if then than of to in on at for with from by as is are was were be been being it its this that these those " +
    "you your we our they their i me my he his she her them us " +
    "not no never do does did done have has had will would should must shall can could may might about into over under " +
    "please agent advice answer analysis brief work result outcome report provide include ensure clearly fully must should " +
    "recommend recommends recommending disclose discloses given make made using use used also very just really would could "
  ).split(/\s+/)
);

const NEG_WORDS =
  /\b(not|no|never|without|don'?t|doesn'?t|won'?t|avoid|banned|prohibited|forbidden|refrain|exclude|excluding|reject|against)\b/;

const NEG_MODAL = new Set(["do", "not", "never", "don", "t", "must", "shall", "should", "no", "without", "avoid", "recommend", "use", "using", "to"]);

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?\n]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

function contentTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 4 && !STOP.has(tok) && !/^\d+$/.test(tok)) out.add(tok);
  }
  return out;
}

/** Loose morphological match: 'leverage' matches 'leveraged' (shared stem). */
function looseHas(text: string, term: string): boolean {
  const words = text.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return words.some((w) => {
    if (w === term) return true;
    const min = Math.min(w.length, term.length);
    if (min < 4) return false;
    return w.startsWith(term) || term.startsWith(w);
  });
}

export interface RequirementCheck {
  text: string;
  kind: "forbid" | "obligation";
  satisfied: boolean;
  note: string;
}

export interface CorpusAnalysis {
  verdict: Verdict;
  checks: RequirementCheck[];
  violated: string[];
  missedRisks: string[];
  riskSignals: string[];
  reasoning: string;
}

function checkRequirement(req: string, workLower: string): RequirementCheck {
  const isForbid = NEG_WORDS.test(req.toLowerCase());
  if (isForbid) {
    const target = [...contentTerms(req)].filter((t) => !NEG_MODAL.has(t));
    const hits: string[] = [];
    for (const s of sentences(workLower)) {
      const found = target.some((t) => looseHas(s, t));
      if (found) {
        const negated = NEG_WORDS.test(s);
        hits.push(s);
        if (!negated) {
          return {
            text: req,
            kind: "forbid",
            satisfied: false,
            note: `Work "${s.trim()}" touches a prohibited topic without stating an exclusion.`,
          };
        }
      }
    }
    return {
      text: req,
      kind: "forbid",
      satisfied: true,
      note: hits.length
        ? "Prohibited topics are only mentioned alongside an explicit exclusion."
        : "No prohibited topic appears in the work.",
    };
  }

  // Positive obligation: work should cover the requirement's subject terms.
  const terms = [...contentTerms(req)];
  if (terms.length === 0) return { text: req, kind: "obligation", satisfied: true, note: "No measurable terms." };
  const hitTerms = terms.filter((t) => looseHas(workLower, t));
  const needed = Math.max(1, Math.ceil(terms.length * 0.4));
  const satisfied = hitTerms.length >= needed;
  return {
    text: req,
    kind: "obligation",
    satisfied,
    note: satisfied
      ? `Work covers requirement terms (${hitTerms.join(", ")}).`
      : `Work is missing requirement terms (found ${hitTerms.join(", ")} of needed ${needed}: ${terms.join(", ")}).`,
  };
}

/** Evaluate a dispute corpus locally. Returns the verdict + full rationale. */
export function analyzeCorpus(input: {
  brief: string;
  requirements: string[];
  riskRequirements: string[];
  work: string;
  challengeReason?: string;
}): CorpusAnalysis {
  const workLower = input.work.toLowerCase();
  const checks = input.requirements
    .filter((r) => r.trim())
    .map((r) => checkRequirement(r, workLower));

  const violated = checks.filter((c) => !c.satisfied).map((c) => c.text);

  const riskSignals = RISK_LEXICON.filter((w) => workLower.includes(w));
  const missedRisks = input.riskRequirements
    .filter((r) => r.trim())
    .filter(() => riskSignals.length === 0)
    .map((r) => r);

  let verdict: Verdict;
  const parts: string[] = [];
  if (violated.length > 0) {
    verdict = "FAIL";
    parts.push(
      `Explicit requirement${violated.length > 1 ? "s" : ""} violated: ${violated.map((v) => `“${v}”`).join(", ")}.`
    );
  } else if (missedRisks.length > 0) {
    verdict = "PASS_WITH_MATERIAL_RISK";
    parts.push(
      `Work followed the requested task but omitted required material risk disclosure: ${missedRisks
        .map((v) => `“${v}”`)
        .join(", ")}.`
    );
  } else {
    verdict = "PASS";
    parts.push("Work follows the original brief and satisfies every explicit requirement.");
  }
  if (input.challengeReason && input.challengeReason.trim()) {
    parts.push(`Challenge under review: ${input.challengeReason.trim()}`);
  }

  return {
    verdict,
    checks,
    violated,
    missedRisks,
    riskSignals,
    reasoning: parts.join(" "),
  };
}

/** Deterministic Ruling from local analysis — clearly marked simulated. */
export function simulateRuling(r: Receipt): Ruling {
  const analysis = analyzeCorpus({
    brief: r.brief,
    requirements: r.requirements,
    riskRequirements: r.riskRequirements,
    work: r.work,
    challengeReason: r.challenge?.reason,
  });
  return {
    verdict: analysis.verdict,
    briefFollowed: analysis.violated.length === 0,
    requirementsMet: analysis.violated.length === 0,
    materialRiskDisclosed: analysis.missedRisks.length === 0,
    failedRequirements: analysis.violated,
    missedMaterialRisks: analysis.missedRisks,
    reasoning: analysis.reasoning,
    source: "simulated",
    receivedAt: new Date().toISOString(),
  };
}
