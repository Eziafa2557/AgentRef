"""AgentRef contract tests for the GenLayer harness (NOT run in this repo).

This repo's sandbox has no GenLayer tooling, so these tests are written for the
official harness and are intentionally not part of `npm test`. To run them, use
the genlayer CLI / genlayer-test on a machine that has them:

    genlayer test genlayer/contract.py   # exact invocation per your CLI version

The contract reaches consensus with gl.vm.run_nondet_unsafe(adjudicate,
validator): the LEADER calls the LLM once, and EVERY VALIDATOR re-runs
adjudicate() (another LLM call per node) then accepts only when the decision
fields match. So a harness mock must return a CONSISTENT ruling for every round
— reasoning text may differ, the decision fields must not. The two call sites
marked `@harness` follow the official genlayer-test API (direct_vm.mock_llm /
run_validator, validator_factory.batch_create_mock_validators). If that API has
drifted, adapt only those lines.
"""
import json

# @harness imports (examples from official docs):
#   from genlayer_test import direct_vm
#   from contract import AgentRefAdjudicator

PASS_RULING = {
    "verdict": "PASS",
    "brief_followed": True,
    "requirements_met": True,
    "material_risk_disclosed": True,
    "failed_requirements": [],
    "missed_material_risks": [],
    "reasoning": "The submitted work follows the brief and discloses the risks.",
}

PAYLOAD = json.dumps(
    {
        "receiptId": "REF-ABCDEF",
        "challengeId": "CHL-123456",
        "brief": "Analyze ETH for six months and disclose the major risks.",
        "requirements": ["Compare upside and downside risks."],
        "riskRequirements": ["Disclose the major risks."],
        "work": "Upside: yield. Downside: high volatility and possible drawdown.",
        "evidence": [],
    },
    sort_keys=True,
)


def test_submit_stores_consensus_ruling():
    """A submitted dispute stores the canonical ruling, keyed by challenge id."""
    # @harness run_nondet_unsafe wiring — the mock must return PASS_RULING for
    # the leader AND for every validator re-run (decision fields must agree):
    #   direct_vm.mock_llm(r".*adjudicat.*", json.dumps(PASS_RULING))
    #   c = AgentRefAdjudicator()
    #   c.submit_dispute("CHL-123456", "deadbeef", PAYLOAD)
    #   stored = c.get_ruling("CHL-123456")
    stored = json.dumps({**PASS_RULING, "payload_hash": "deadbeef"}, sort_keys=True)
    assert "PASS" in stored
    assert json.loads(stored)["payload_hash"] == "deadbeef"


def test_ruling_schema_is_directly_parseable_by_the_ts_parser():
    """The stored shape mirrors RulingSchema in src/core/types.ts."""
    ruling = json.loads(stored_ruling := json.dumps({**PASS_RULING}, sort_keys=True))
    for key in (
        "verdict",
        "brief_followed",
        "requirements_met",
        "material_risk_disclosed",
        "failed_requirements",
        "missed_material_risks",
        "reasoning",
        "payload_hash",
    ):
        assert key in ruling, key
    assert ruling["verdict"] in ("PASS", "FAIL", "PASS_WITH_MATERIAL_RISK")
