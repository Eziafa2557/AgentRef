/**
 * End-to-end domain flow test — the exact journey a user walks, driven purely
 * through the public core API (no React, no DOM). Exercises the full pipeline:
 *   mint → challenge (with evidence) → integrity → submit → adjudicate →
 *   settle → verify integrity again.
 * Runs against all three seed scenarios and asserts the verdict each one is
 * engineered to produce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDemoReceipts, suggestedChallengeFor } from "./seeds";
import { challengeReceipt } from "./challenge";
import { markUnderReview, applyRuling } from "./settlement";
import { simulateRuling } from "./evaluate";
import { verifyIntegrity } from "./receipt";
import { buildVerificationRequest } from "./verify/request";
import { parseRulingJson } from "./verify/parser";
import { createMemoryRepo } from "./store/repo";
import type { Receipt, Verdict } from "./types";

function runScenario(seedId: string, expected: Verdict) {
  const seed = buildDemoReceipts().find((r) => r.seedId === seedId)!;
  const suggested = suggestedChallengeFor(seedId)!;
  const repo = createMemoryRepo();

  // mint + store
  repo.upsert(seed);
  assert.equal(verifyIntegrity(seed).valid, true);

  // challenge with the suggested dispute
  const { receipt: challenged, challenge } = challengeReceipt(seed, suggested);
  assert.ok(challenge.id.startsWith("CHL-"));
  repo.upsert(challenged);

  // build the payload an adjudicator would see; it fingerprints THIS dispute
  const req = buildVerificationRequest(challenged);
  assert.equal(req.receiptId, seed.id);
  assert.equal(req.challengeId, challenge.id);
  assert.ok(challenged.challenge!.evidence.length > 0);

  // submit → under review
  const underReview = markUnderReview(challenged);

  // adjudicate (SIMULATED path)
  const ruling = simulateRuling(underReview);
  assert.equal(ruling.source, "simulated");
  const settled = applyRuling(underReview, ruling);
  assert.equal(settled.ruling!.verdict, expected);

  // settlement honesty: verdict maps to a simulated escrow state
  if (expected === "FAIL") assert.equal(settled.settlement, "LOCKED");
  else assert.equal(settled.settlement, "RELEASED");

  // integrity survives the whole journey
  const report = verifyIntegrity(settled);
  assert.equal(report.valid, true, report.checks.filter((c) => !c.ok).map((c) => c.label).join(", "));

  // ruling is parseable through the same parser the GenLayer path uses
  const parsed = parseRulingJson(JSON.stringify(ruling), "genlayer");
  assert.equal(parsed.verdict, expected);
  assert.equal(parsed.source, "genlayer");
}

test("full journey: PASS scenario", () => runScenario("seed-pass", "PASS"));
test("full journey: FAIL scenario", () => runScenario("seed-fail", "FAIL"));
test("full journey: MATERIAL RISK scenario", () =>
  runScenario("seed-material-risk", "PASS_WITH_MATERIAL_RISK"));

test("store + provider-shaped flow keeps one source of truth", () => {
  const repo = createMemoryRepo();
  const [pass] = buildDemoReceipts();
  repo.upsert(pass);
  const again = repo.get(pass.id)!;
  assert.equal(again.id, pass.id);
  assert.equal(repo.list().length, 1);
  // ruling object is not shared by reference (defensive copy)
  const a = repo.get(pass.id)!;
  const b = repo.get(pass.id)!;
  a.brief = "mutated";
  assert.notEqual(b.brief, "mutated");
});
