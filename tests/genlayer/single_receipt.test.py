"""Tests for the single-receipt AgentRef contract (genlayer/single_receipt.py).

Two layers, deliberately:

1. `python3 tests/genlayer/single_receipt.test.py` — runs ANYWHERE python3
   exists, with no GenLayer tooling. It installs a small stub `genlayer` module
   so the contract imports, then drives the REAL judgment path: `adjudicate()`
   end to end (leader → validator → consensus → storage) plus the pure helpers
   that decide agreement. The consensus-critical logic is exactly the part most
   likely to be wrong, so it should not be untestable without a testnet.

2. `@harness` tests — for the official genlayer-test VM, which adds what the
   stub cannot: real nondeterminism, real validator rotation, real storage
   semantics. Not run in this repo's sandbox (it has no python3 or genlayer
   CLI). Invocation per your CLI version, e.g. `genlayer test <contract>`.

Why the stub can prove anything: the contract's validators compare the DECISION
FIELDS of a ruling, not the raw LLM text. That comparison is pure string
normalization, so a deterministic stub model exercises every branch of it.
"""
import importlib
import json
import os
import sys
import types

CONTRACT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "genlayer",
    "single_receipt.py",
)


# --------------------------------------------------------------------------
# Stub genlayer module — enough to import the contract and run its logic.
# --------------------------------------------------------------------------
class _Decorator:
    def __call__(self, fn):
        return fn


class _Public:
    write = _Decorator()
    view = _Decorator()


class _UserError(Exception):
    pass


class _Return:
    """Mirrors gl.vm.Return: the leader's outcome, payload on `.calldata`."""

    def __init__(self, calldata):
        self.calldata = calldata


class _Vm:
    Return = _Return

    #: The ruling the stubbed model returns for the NEXT exec_prompt call.
    next_result = None
    #: Every prompt the contract has sent, in order.
    prompts = []
    #: How many times run_nondet_unsafe had to rotate leaders before agreement.
    rotations = 0

    @classmethod
    def run_nondet_unsafe(cls, leader_fn, validator_fn):
        """Faithful-enough stand-in for the VM's consensus loop.

        Runs the leader, hands the validator a gl.vm.Return, and — like the real
        network — retries with a new leader when the validator refuses. Raises
        if no leader can ever be agreed on, which is what a contract that can
        never reach consensus must do rather than commit a bad ruling.
        """
        for attempt in range(3):
            cls.rotations = attempt
            try:
                leader_out = leader_fn()
            except Exception as exc:  # leader failed: validators must refuse
                if validator_fn(exc):
                    return None
                continue
            if validator_fn(_Return(leader_out)):
                return leader_out
        raise RuntimeError("no leader reached consensus")


class _Nondet:
    @staticmethod
    def exec_prompt(prompt, response_format="text"):
        _Vm.prompts.append(prompt)
        result = _Vm.next_result
        if isinstance(result, Exception):
            raise result
        return result


def _install_stub_genlayer():
    """Register a stub `genlayer` module so the contract imports without the VM."""
    mod = types.ModuleType("genlayer")
    gl = types.SimpleNamespace(
        Contract=type("Contract", (), {}),
        public=_Public(),
        UserError=_UserError,
        nondet=_Nondet(),
        vm=_Vm(),
    )
    mod.gl = gl
    sys.modules["genlayer"] = mod
    return mod


_install_stub_genlayer()

sys.path.insert(0, os.path.dirname(CONTRACT_PATH))
contract = importlib.import_module(os.path.splitext(os.path.basename(CONTRACT_PATH))[0])
gl = sys.modules["genlayer"].gl


PASS_RULING = {
    "verdict": "PASS",
    "brief_followed": True,
    "requirements_met": True,
    "material_risk_disclosed": True,
    "failed_requirements": [],
    "missed_material_risks": [],
    "score": "4/4",
    "reason": "The work follows the brief and discloses the risks.",
}

FAIL_RULING = {
    "verdict": "FAIL",
    "brief_followed": False,
    "requirements_met": False,
    "material_risk_disclosed": False,
    "failed_requirements": ["Disclose the major risks."],
    "missed_material_risks": ["Disclose the major risks."],
    "score": "2/4",
    "reason": "The work omits the required risk disclosure.",
}

RISK_RULING = {
    "verdict": "PASS_WITH_MATERIAL_RISK",
    "brief_followed": True,
    "requirements_met": True,
    "material_risk_disclosed": False,
    "failed_requirements": [],
    "missed_material_risks": ["Disclose the major risks."],
    "score": "4/4",
    "reason": "Requirements met but the risk section is thin.",
}


def _fresh(ruling):
    """A contract with a receipt filed, and the model primed to return `ruling`."""
    _Vm.prompts = []
    _Vm.next_result = ruling
    c = contract.AgentRefReceipt()
    c.create_receipt(
        "Analyze ETH for six months and disclose the major risks.",
        "Upside: yield. Downside: high volatility and possible drawdown.",
        "[excerpt]\nsome evidence",
        "Orbit Research AI",
    )
    c.challenge("TVL figures outdated.", "some evidence")
    return c


# --------------------------------------------------------------------------
# get_receipt() — the contract the frontend parser depends on
# --------------------------------------------------------------------------
def test_empty_receipt_line_matches_the_frontend_parser():
    """The exact byte sequence `parseReceiptLine` was written against."""
    c = contract.AgentRefReceipt()
    assert c.get_receipt() == "Status: EMPTY | Agent:  | Brief:  | Work:  | No challenge | Score:  | Reason: "


def test_challenged_receipt_uses_the_challenge_prefixed_line():
    c = _fresh(PASS_RULING)
    assert "Challenge: TVL figures outdated. | some evidence" in c.get_receipt()
    assert c.get_receipt().startswith("Status: CHALLENGED | Agent: Orbit Research AI | ")


# --------------------------------------------------------------------------
# The judgment path — leader, validator, consensus, stored state
# --------------------------------------------------------------------------
def test_adjudicate_stores_a_pass_as_verified():
    c = _fresh(PASS_RULING)
    c.adjudicate()
    assert c.status == "VERIFIED"
    assert c.score == "4/4"
    assert c.reason == PASS_RULING["reason"]


def test_adjudicate_stores_a_fail_as_not_verified():
    c = _fresh(FAIL_RULING)
    c.adjudicate()
    assert c.status == "NOT_VERIFIED"
    assert c.score == "2/4"


def test_adjudicate_reaches_consensus_not_a_single_opinion():
    """The validator must re-run the judgement — one LLM call is not consensus."""
    c = _fresh(PASS_RULING)
    c.adjudicate()
    # leader + at least one independent validator each asked the model:
    assert len(_Vm.prompts) >= 2
    assert _Vm.rotations == 0


def test_validator_agrees_despite_differently_worded_reasoning():
    """Nodes phrase prose differently; that must NOT break consensus.

    The stub returns a ruling whose `reason` differs from the leader's — the
    real-world case the decision-field comparison exists to tolerate.
    """
    leader = dict(PASS_RULING, reason="Leader wording.")
    validator = dict(PASS_RULING, reason="A totally different sentence.")
    assert contract._decision_fields(leader) == contract._decision_fields(validator)


def test_validator_rejects_a_different_verdict():
    assert contract._decision_fields(PASS_RULING) != contract._decision_fields(FAIL_RULING)


def test_validator_ignores_requirement_ordering():
    """Two nodes listing the same violations in another order still agree."""
    a = dict(FAIL_RULING, failed_requirements=["A", "B"], missed_material_risks=[])
    b = dict(FAIL_RULING, failed_requirements=["B", "A"], missed_material_risks=[])
    assert contract._decision_fields(a) == contract._decision_fields(b)


def test_validator_rejects_a_malformed_leader_result():
    """A garbage leader must never compare equal to a good ruling."""
    assert contract._decision_fields(None) is None
    assert contract._decision_fields("not a dict") is None
    assert contract._decision_fields(PASS_RULING) != contract._decision_fields(None)


def test_adjudicate_rotates_when_the_model_returns_junk():
    """Malformed model output must not be committed — the network retries.

    With a permanently broken model every leader fails, so adjudicate() must
    raise rather than write a bogus verdict to storage.
    """
    c = _fresh("this is not json at all")
    raised = False
    try:
        c.adjudicate()
    except Exception:
        raised = True
    assert raised, "a contract that cannot reach consensus must not store a ruling"
    assert c.status == "CHALLENGED", "storage must be untouched after a failed consensus"


def test_validator_refuses_a_leader_whose_payload_is_not_a_ruling():
    """A payload that is not a ruling must never reach consensus.

    Force the judgement to yield a non-dict, so the leader's payload normalizes
    to None on BOTH sides — which a naive `==` would read as agreement. Also
    guards the real-chain case this stub can't reproduce: calldata coming back
    in an unexpected shape.
    """
    original = contract._coerce_ruling
    contract._coerce_ruling = lambda raw: ["not", "a", "ruling"]
    try:
        c = _fresh(PASS_RULING)
        raised = False
        try:
            c.adjudicate()
        except Exception:
            raised = True
        assert raised, "a non-ruling payload must not reach consensus"
        assert c.status == "CHALLENGED", "storage must be untouched"
    finally:
        contract._coerce_ruling = original


def test_adjudicate_rejects_an_out_of_vocabulary_verdict():
    c = _fresh(dict(PASS_RULING, verdict="MAYBE"))
    raised = False
    try:
        c.adjudicate()
    except Exception:
        raised = True
    assert raised


# --------------------------------------------------------------------------
# The three-way verdict collapsing onto the app's two on-chain statuses
# --------------------------------------------------------------------------
def test_material_risk_pass_is_verified_but_keeps_the_risk_visible():
    """PASS_WITH_MATERIAL_RISK must never read as a clean pass."""
    c = _fresh(RISK_RULING)
    c.adjudicate()
    assert c.status == "VERIFIED"
    assert "material risk" in c.reason.lower()
    assert "Disclose the major risks." in c.reason


# --------------------------------------------------------------------------
# Guards
# --------------------------------------------------------------------------
def test_cannot_challenge_before_a_receipt_exists():
    c = contract.AgentRefReceipt()
    raised = False
    try:
        c.challenge("too early", "")
    except gl.UserError:
        raised = True
    assert raised


def test_cannot_adjudicate_before_a_receipt_exists():
    c = contract.AgentRefReceipt()
    raised = False
    try:
        c.adjudicate()
    except gl.UserError:
        raised = True
    assert raised


def test_cannot_challenge_an_already_adjudicated_receipt():
    c = _fresh(PASS_RULING)
    c.adjudicate()
    raised = False
    try:
        c.challenge("again", "")
    except gl.UserError:
        raised = True
    assert raised


def test_create_receipt_clears_a_previous_verdict():
    c = _fresh(PASS_RULING)
    c.adjudicate()
    c.create_receipt("New brief", "New work", "", "Other Agent")
    assert c.status == "OPEN"
    assert c.score == ""
    assert c.reason == ""
    assert "No challenge" in c.get_receipt()


# --------------------------------------------------------------------------
# The prompt must actually carry the material being judged
# --------------------------------------------------------------------------
def test_prompt_carries_brief_work_evidence_and_challenge():
    c = _fresh(PASS_RULING)
    c.adjudicate()
    prompt = _Vm.prompts[0]
    assert "Analyze ETH for six months" in prompt
    assert "high volatility and possible drawdown" in prompt
    assert "some evidence" in prompt
    assert "TVL figures outdated." in prompt


def test_unchallenged_receipt_says_so_in_the_prompt():
    _Vm.prompts = []
    _Vm.next_result = PASS_RULING
    c = contract.AgentRefReceipt()
    c.create_receipt("brief", "work", "", "agent")
    c.adjudicate()
    assert "not challenged" in _Vm.prompts[0]


# --------------------------------------------------------------------------
# @harness — needs the real genlayer-test VM (not run in this repo)
# --------------------------------------------------------------------------
# The stub above proves the LOGIC; only the real VM proves the VM INTEGRATION:
# that gl.nondet.exec_prompt is reachable inside a nondet block on the target
# chain, that storage writes after run_nondet_unsafe are permitted, and that
# the validator is really invoked per node. Run these on a machine with the CLI.
#
#   from genlayer_test import direct_vm
#   from single_receipt import AgentRefReceipt
#
#   def test_harness_pass_end_to_end():
#       direct_vm.mock_llm(r".*", json.dumps(PASS_RULING))
#       c = AgentRefReceipt()
#       c.create_receipt("brief", "work", "evidence", "agent")
#       c.challenge("reason", "evidence")
#       c.adjudicate()
#       assert c.get_receipt().startswith("Status: VERIFIED | ")
#
#   def test_harness_fail_end_to_end():
#       direct_vm.mock_llm(r".*", json.dumps(FAIL_RULING))
#       ...
#       assert c.get_receipt().startswith("Status: NOT_VERIFIED | ")
#
#   def test_harness_validators_run_the_judgement():
#       # validator_factory.batch_create_mock_validators(...) then assert the
#       # validator path executed, i.e. consensus was real, not a single call.


if __name__ == "__main__":
    failures = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  ok   {name}")
        except Exception as exc:
            failures += 1
            print(f"  FAIL {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)
