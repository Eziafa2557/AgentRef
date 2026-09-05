import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCorpus, simulateRuling } from "./evaluate";
import { buildDemoReceipts } from "./seeds";
import { createReceipt } from "./receipt";
import { challengeReceipt } from "./challenge";

test("PASS when work follows the brief and satisfies requirements", () => {
  const a = analyzeCorpus({
    brief: "Analyze ETH for six months and compare downside risks.",
    requirements: ["Compare upside and downside risks.", "Disclose the major risks."],
    riskRequirements: [],
    work: "Upside: yield. Downside risk: a drawdown is possible. Major risks are volatility and loss of value.",
  });
  assert.equal(a.verdict, "PASS");
  assert.equal(a.violated.length, 0);
});

test("FAIL when work violates an explicit 'do not' requirement", () => {
  const a = analyzeCorpus({
    brief: "Do not recommend leverage.",
    requirements: ["Do not recommend leverage or derivatives."],
    riskRequirements: [],
    work: "We recommend opening a 3x leveraged long via perpetual futures.",
  });
  assert.equal(a.verdict, "FAIL");
  assert.deepEqual(a.violated, ["Do not recommend leverage or derivatives."]);
});

test("mentioning a prohibited topic with an explicit exclusion is not a violation", () => {
  const a = analyzeCorpus({
    brief: "Do not recommend leverage.",
    requirements: ["Do not recommend leverage or derivatives."],
    riskRequirements: [],
    work: "We considered leverage but do not recommend it — the client is risk-averse.",
  });
  assert.equal(a.verdict, "PASS");
});

test("PASS_WITH_MATERIAL_RISK when a required downside-risk disclosure is missing", () => {
  const a = analyzeCorpus({
    brief: "Disclose the major downside risks for a conservative client.",
    requirements: ["State a clear position."],
    riskRequirements: ["Clearly disclose the major downside risks."],
    work: "Our clear position: we are confident and expect continued appreciation, with upside only.",
  });
  assert.equal(a.verdict, "PASS_WITH_MATERIAL_RISK", a.reasoning);
  assert.equal(a.missedRisks.length, 1);
});

test("disclosing the downside risk satisfies the risk requirement", () => {
  const a = analyzeCorpus({
    brief: "Disclose downside risks.",
    requirements: ["Give a recommendation."],
    riskRequirements: ["Clearly disclose the major downside risks."],
    work: "Recommendation: hold. Downside risk includes volatility and a large drawdown.",
  });
  assert.equal(a.verdict, "PASS");
  assert.equal(a.missedRisks.length, 0);
});

test("seed corpus drives the intended verdicts", () => {
  const [pass, fail, risk] = buildDemoReceipts();
  const passA = analyzeCorpus(pass);
  assert.equal(passA.verdict, "PASS", passA.reasoning);

  const failA = analyzeCorpus(fail);
  assert.equal(failA.verdict, "FAIL", failA.reasoning);
  assert.ok(failA.violated.some((v) => /leverage|derivatives/i.test(v)));

  const riskA = analyzeCorpus(risk);
  assert.equal(riskA.verdict, "PASS_WITH_MATERIAL_RISK", riskA.reasoning);
  assert.equal(riskA.missedRisks.length, 1);
});

test("simulateRuling marks the source simulated and references real evidence", () => {
  let r = buildDemoReceipts()[1]; // FAIL seed
  r = challengeReceipt(r, {
    reason: "leverage recommended",
    violatedRequirements: ["Do not recommend leverage or derivatives of any kind."],
    missedRiskRequirements: [],
    additionalContext: "",
    challengerName: "T",
    evidence: [{ label: "memo", content: r.work }],
  }).receipt;
  const ruling = simulateRuling(r);
  assert.equal(ruling.source, "simulated");
  assert.equal(ruling.verdict, "FAIL");
  assert.match(ruling.reasoning, /leverage|derivatives/i);
});

test("error-state guard: empty brief/work is rejected at receipt creation", () => {
  assert.throws(() =>
    createReceipt({
      briefTitle: "",
      brief: "   ",
      requirements: [],
      riskRequirements: [],
      agentName: "a",
      requesterName: "r",
      workTitle: "",
      work: "",
      paymentAmountUsd: 0,
    })
  );
});
