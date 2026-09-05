import type { Ruling, RulingSchema, VerificationSource, Verdict } from "../types";

export class RulingValidationError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`Invalid ruling: ${problems.join("; ")}`);
    this.name = "RulingValidationError";
    this.problems = problems;
  }
}

/** Normalize a verdict token tolerantly: PASS | FAIL | PASS_WITH_MATERIAL_RISK. */
export function normalizeVerdict(v: unknown): Verdict | null {
  if (typeof v !== "string") return null;
  const norm = v
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (norm === "PASS") return "PASS";
  if (norm === "FAIL") return "FAIL";
  if (norm === "PASS_WITH_MATERIAL_RISK") return "PASS_WITH_MATERIAL_RISK";
  return null;
}

function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") return ["true", "1", "yes", "pass", "ok"].includes(v.toLowerCase());
  return false;
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Validate + normalize an external ruling into a typed `Ruling`.
 *
 * Hard requirements: the raw value must be an object and `verdict` must map to
 * one of the three supported verdicts. Everything else is coerced leniently so
 * a well-formed GenLayer response with slightly different phrasing still works.
 */
export function parseRuling(
  raw: unknown,
  source: VerificationSource,
  meta?: { transactionHash?: string; contractAddress?: string; finalizedRound?: number }
): Ruling {
  const problems: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RulingValidationError(["Expected a JSON object."]);
  }
  const o = raw as Record<string, unknown>;
  const verdict = normalizeVerdict(o.verdict);
  if (!verdict) {
    problems.push(`verdict must be one of PASS, FAIL, PASS_WITH_MATERIAL_RISK (got ${JSON.stringify(o.verdict)}).`);
  }
  if (typeof o.reasoning !== "undefined" && typeof o.reasoning !== "string") {
    problems.push("reasoning must be a string.");
  }
  if (problems.length > 0) {
    throw new RulingValidationError(problems);
  }

  const schema: RulingSchema = {
    verdict: verdict as Verdict,
    brief_followed: toBool(o.brief_followed),
    requirements_met: toBool(o.requirements_met),
    material_risk_disclosed: toBool(o.material_risk_disclosed),
    failed_requirements: toStringArray(o.failed_requirements),
    missed_material_risks: toStringArray(o.missed_material_risks),
    reasoning: (typeof o.reasoning === "string" && o.reasoning.trim()
      ? o.reasoning
      : "Validators returned a verdict with no explanation."
    ).trim(),
  };

  return {
    verdict: schema.verdict,
    briefFollowed: schema.brief_followed,
    requirementsMet: schema.requirements_met,
    materialRiskDisclosed: schema.material_risk_disclosed,
    failedRequirements: schema.failed_requirements,
    missedMaterialRisks: schema.missed_material_risks,
    reasoning: schema.reasoning,
    source,
    receivedAt: new Date().toISOString(),
    transactionHash: meta?.transactionHash,
    contractAddress: meta?.contractAddress,
    finalizedRound: meta?.finalizedRound,
  };
}

/** Parse a ruling that arrived as a JSON *string* (GenLayer returns strings). */
export function parseRulingJson(
  json: string,
  source: VerificationSource,
  meta?: { transactionHash?: string; contractAddress?: string; finalizedRound?: number }
): Ruling {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new RulingValidationError([`Not valid JSON: ${json.slice(0, 120)}…`]);
  }
  return parseRuling(raw, source, meta);
}
