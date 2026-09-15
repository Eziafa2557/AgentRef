"""Tests for the single-receipt AgentRef contract (genlayer/single_receipt.py).

Two layers, deliberately:

1. `python3 tests/genlayer/single_receipt.test.py` — runs ANYWHERE python3
   exists, with no GenLayer tooling. It installs a stub `genlayer` package (with
   a `contract` submodule, `types`, `public`, `nondet` and `vm`) so the contract
   imports exactly as it does on the real runner, then drives the REAL judgment
   path: adjudicate() end to end (leader -> validator -> consensus -> storage)
   plus the pure helpers that decide agreement. The consensus-critical logic is
   the part most likely to be wrong, so it should not be untestable without a
   testnet.

2. `@harness` tests — for the official genlayer-test VM, which adds what the
   stub cannot: real nondeterminism, real validator rotation, real storage
   semantics. NOT run in this repo's sandbox (no python3, no genlayer CLI).

The stub mirrors the CURRENT runner idiom, not the legacy one: `gl` is the
package (`import genlayer as gl`), the base is `gl.contract.Contract`, and the
error is `gl.vm.UserError`. If the contract were written with the legacy
`from genlayer import *` + `gl.Contract`, this stub would fail it the same way
the real runner would.

Why the stub can prove anything: the contract's validators compare the DECISION
FIELDS of a ruling, not the raw LLM text. That comparison is pure string
normalization, so a deterministic stub model exercises every branch of it.
"""
import ast
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
# Stub `genlayer` package — enough to import the contract and run its logic.
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
    UserError = _UserError

    #: The ruling the stubbed model returns for the NEXT exec_prompt call.
    next_result = None
    #: Every prompt the contract has sent, in order.
    prompts = []
    #: Which leader attempt the last run_nondet_unsafe got agreement on.
    rotations = 0

    @classmethod
    def run_nondet_unsafe(cls, leader_fn, validator_fn):
        """Stand-in for the VM's consensus loop.

        Runs the leader, hands the validator a gl.vm.Return, and — like the real
        network — retries with a new leader when the validator refuses. Raises
        if no leader can ever be agreed on, which is what a contract that cannot
        reach consensus must do rather than commit a bad ruling.
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
    """Register a stub `genlayer` package so the contract imports unmodified."""
    pkg = types.ModuleType("genlayer")
    pkg.__path__ = []  # mark as a package so `from genlayer.types import *` works

    contract_mod = types.ModuleType("genlayer.contract")

    class _Contract:
        pass

    contract_mod.Contract = _Contract

    types_mod = types.ModuleType("genlayer.types")

    vm = _Vm()
    pkg.contract = contract_mod
    pkg.types = types_mod
    pkg.public = _Public()
    pkg.nondet = _Nondet()
    pkg.vm = vm

    sys.modules["genlayer"] = pkg
    sys.modules["genlayer.contract"] = contract_mod
    sys.modules["genlayer.types"] = types_mod
    return pkg


_genlayer = _install_stub_genlayer()

sys.path.insert(0, os.path.dirname(CONTRACT_PATH))
contract = importlib.import_module(os.path.splitext(os.path.basename(CONTRACT_PATH))[0])
gl = _genlayer


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
    """A contract with a receipt filed and challenged, model primed for `ruling`."""
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
# The contract must use the CURRENT runner idiom, not the legacy one
# --------------------------------------------------------------------------
def test_contract_extends_the_package_contract_base():
    """gl.contract.Contract — not gl.Contract. The legacy base would NameError
    on the current runner because `gl` is no longer star-exported."""
    assert issubclass(contract.AgentRefReceipt, gl.contract.Contract)


def _contract_ast():
    """Parse the contract with ast — the closest thing to a compile check."""
    with open(CONTRACT_PATH, encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=CONTRACT_PATH)


def test_contract_parses_as_python():
    """A SyntaxError here means the file would not even deploy."""
    _contract_ast()


def test_contract_uses_the_current_import_idiom():
    """`from genlayer import *` would not bind `gl` on the current runner.

    Checked via the AST, not a substring search: the module docstring quotes the
    legacy form when explaining why it is wrong.
    """
    tree = _contract_ast()
    star_imports = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.ImportFrom) and n.module == "genlayer"
        and any(a.name == "*" for a in n.names)
    ]
    assert star_imports == [], "from genlayer import * does not bind `gl` on the current runner"
    gl_imports = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Import) and any(a.name == "genlayer" and a.asname == "gl" for a in n.names)
    ]
    assert gl_imports, "expected `import genlayer as gl`"


def test_contract_header_pins_a_runner_hash_on_the_first_lines():
    with open(CONTRACT_PATH, encoding="utf-8") as fh:
        head = fh.read(400)
    assert "py-genlayer:" in head
    assert '"Depends"' in head


def test_no_float_literals_in_the_contract():
    """The linter rejects floats in contracts — persisted values must be exact."""
    tree = _contract_ast()
    floats = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, float)]
    assert floats == []


def test_no_banned_module_imports():
    """The linter forbids random/os/sys/subprocess and friends."""
    tree = _contract_ast()
    banned = {"random", "os", "sys", "subprocess", "time", "socket", "shutil"}
    used = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            used.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            used.add(node.module.split(".")[0])
    assert not (used & banned), "banned imports: " + repr(sorted(used & banned))


# --------------------------------------------------------------------------
# get_receipt() — the exact line the frontend parser depends on
# --------------------------------------------------------------------------
def test_empty_receipt_line_matches_the_frontend_parser():
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
    assert len(_Vm.prompts) >= 2, "leader + at least one independent validator"
    assert _Vm.rotations == 0


def test_validator_agrees_despite_differently_worded_reasoning():
    """Nodes phrase prose differently; that must NOT break consensus."""
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
# Robustness of the model-response parsing
# --------------------------------------------------------------------------
def test_fenced_json_is_recovered():
    """Models wrap JSON in ``` fences — that must not cost a leader rotation."""
    fenced = "```json\n" + json.dumps(PASS_RULING) + "\n```"
    assert contract._coerce_ruling(fenced)["verdict"] == "PASS"


def test_bare_fenced_json_is_recovered():
    fenced = "```\n" + json.dumps(PASS_RULING) + "\n```"
    assert contract._coerce_ruling(fenced)["verdict"] == "PASS"


def test_json_with_preamble_is_recovered():
    noisy = "Sure, here is the ruling:\n" + json.dumps(FAIL_RULING) + "\nHope that helps!"
    assert contract._coerce_ruling(noisy)["verdict"] == "FAIL"


def test_fenced_and_preamble_agree_with_the_bare_object():
    """All three spellings must normalize to the SAME decision fields, or two
    honest nodes would disagree purely over formatting."""
    bare = contract._decision_fields(contract._coerce_ruling(PASS_RULING))
    fenced = contract._decision_fields(contract._coerce_ruling("```json\n" + json.dumps(PASS_RULING) + "\n```"))
    noisy = contract._decision_fields(contract._coerce_ruling("Here you go: " + json.dumps(PASS_RULING)))
    assert bare == fenced == noisy


def test_unparseable_response_raises():
    raised = False
    try:
        contract._coerce_ruling("no json here at all")
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
    except gl.vm.UserError:
        raised = True
    assert raised


def test_cannot_adjudicate_before_a_receipt_exists():
    c = contract.AgentRefReceipt()
    raised = False
    try:
        c.adjudicate()
    except gl.vm.UserError:
        raised = True
    assert raised


def test_cannot_challenge_an_already_adjudicated_receipt():
    c = _fresh(PASS_RULING)
    c.adjudicate()
    raised = False
    try:
        c.challenge("again", "")
    except gl.vm.UserError:
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
# @harness — needs the real genlayer-test VM (NOT run in this repo)
# --------------------------------------------------------------------------
# The stub above proves the LOGIC. Only the real VM proves the VM INTEGRATION:
# that gl.nondet.exec_prompt is reachable inside a nondet block on studio-dev,
# that storage writes after run_nondet_unsafe are permitted, and that the
# validator is really invoked per node. Run these where the CLI exists.
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
            print("  ok   " + name)
        except Exception as exc:
            failures += 1
            print("  FAIL " + name + ": " + type(exc).__name__ + ": " + str(exc))
    print("\n" + str(len(tests) - failures) + "/" + str(len(tests)) + " passed")
    sys.exit(1 if failures else 0)
