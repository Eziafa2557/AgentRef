import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVerdict, parseRuling, parseRulingJson, RulingValidationError } from "./parser";

test("normalizeVerdict accepts case/spacing variants", () => {
  assert.equal(normalizeVerdict("pass"), "PASS");
  assert.equal(normalizeVerdict(" FAIL "), "FAIL");
  assert.equal(normalizeVerdict("pass_with_material_risk"), "PASS_WITH_MATERIAL_RISK");
  assert.equal(normalizeVerdict("PASS WITH MATERIAL RISK"), "PASS_WITH_MATERIAL_RISK");
  assert.equal(normalizeVerdict("MAYBE"), null);
});

test("parseRuling normalizes a well-formed response", () => {
  const ruling = parseRuling(
    {
      verdict: "PASS",
      brief_followed: true,
      requirements_met: true,
      material_risk_disclosed: true,
      failed_requirements: [],
      missed_material_risks: [],
      reasoning: "The work followed the brief.",
    },
    "genlayer",
    { transactionHash: "0xabc", contractAddress: "0xcontract", finalizedRound: 42 }
  );
  assert.equal(ruling.verdict, "PASS");
  assert.equal(ruling.briefFollowed, true);
  assert.equal(ruling.source, "genlayer");
  assert.equal(ruling.transactionHash, "0xabc");
  assert.equal(ruling.finalizedRound, 42);
});

test("parseRuling is lenient on booleans but keeps verdict strict", () => {
  const r = parseRuling(
    { verdict: "FAIL", brief_followed: "false", requirements_met: 0, reasoning: "" },
    "simulated"
  );
  assert.equal(r.briefFollowed, false);
  assert.equal(r.reasoning.length > 0, true); // fallback explanation
});

test("invalid verdict is rejected with a typed error", () => {
  assert.throws(
    () => parseRuling({ verdict: "UNKNOWN", reasoning: "x" }, "genlayer"),
    (e: unknown) => e instanceof RulingValidationError && e.problems.length > 0
  );
});

test("non-object / null payload is rejected", () => {
  assert.throws(() => parseRuling(null, "genlayer"), RulingValidationError);
  assert.throws(() => parseRuling([1, 2], "genlayer"), RulingValidationError);
  assert.throws(() => parseRuling("not an object", "genlayer"), RulingValidationError);
});

test("parseRulingJson handles a JSON string from a contract", () => {
  const r = parseRulingJson(
    JSON.stringify({ verdict: "PASS_WITH_MATERIAL_RISK", reasoning: "risk omitted" }),
    "genlayer"
  );
  assert.equal(r.verdict, "PASS_WITH_MATERIAL_RISK");
});

test("parseRulingJson rejects malformed JSON", () => {
  assert.throws(() => parseRulingJson("{not json", "genlayer"), RulingValidationError);
});

test("missing required fields degrade safely without crashing", () => {
  const r = parseRuling({ verdict: "PASS" }, "simulated");
  assert.equal(r.failedRequirements.length, 0);
  assert.equal(r.materialRiskDisclosed, false);
});
