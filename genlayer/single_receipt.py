# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9feyyls9qz98sz2nbrd8mg4sxqg2qng" }
"""
AgentRef single-receipt adjudicator — a GenLayer Intelligent Contract.

Surface (unchanged from the contract the app already speaks, so the frontend,
its parseReceiptLine parser and the 74 JS tests need no edit):

    create_receipt(brief, work, evidence, agent)
    challenge(reason, evidence)
    adjudicate()
    get_receipt() -> "Status: ... | Agent: ... | Brief: ... | Work: ... | <challenge> | Score: ... | Reason: ..."

WHY THIS FILE EXISTS
--------------------
The previously deployed contract's adjudicate() called `gl.exec_prompt(...)`,
which does not exist in the current GenVM, so it could never produce a verdict —
that is why it sat at Status: EMPTY forever. It also made a single
un-consensused LLM call, so "judged by GenLayer validators" was never true of
it. This replaces it with a real validator-consensus judgement.

RUNTIME IDIOM (current runner)
------------------------------
The current GenVM runner is not the legacy one:

    import genlayer as gl          # `gl` is the package, NOT star-exported
    from genlayer.types import *   # type aliases (u256, Address, ...)
    class X(gl.contract.Contract)  # NOT gl.Contract
    raise gl.vm.UserError(...)     # NOT gl.UserError

The legacy form (`from genlayer import *` + `gl.Contract` + `gl.UserError`)
still runs on the older node genvm but FAILS on this runner: `gl` is no longer
star-exported, so the class body would raise NameError. If you ever target an
older chain, that is the one thing to swap.

CONSENSUS MODEL (Equivalence Principle)
---------------------------------------
An LLM call is non-deterministic, so exact-match consensus over the whole
response — free-form reasoning included — would never agree. Instead this uses
`gl.vm.run_nondet_unsafe`:

  * the LEADER runs judge() and produces a ruling;
  * every VALIDATOR re-runs judge() (its own independent LLM call) and accepts
    the leader ONLY when the DECISION FIELDS agree — verdict, the booleans, the
    requirement/risk lists and the score, order-normalized;
  * free-form `reason` is excluded from the comparison (nodes word prose
    differently); the leader's wording is the one stored;
  * a failed leader, a non-ruling payload, or a malformed model response makes
    the validator return False, so the network rotates to another leader rather
    than committing garbage.

Storage is written only AFTER consensus, back in deterministic context. The
nondet block reads no storage, emits nothing, and makes no contract calls — and
never nests another nondet block.

VERDICT SEMANTICS
-----------------
The model answers with the three-way AgentRef verdict PASS / FAIL /
PASS_WITH_MATERIAL_RISK. The contract stores the two on-chain statuses the app
already parses as decided:

    FAIL                     -> NOT_VERIFIED
    PASS                     -> VERIFIED
    PASS_WITH_MATERIAL_RISK  -> VERIFIED, with the undisclosed risk named in
                                Reason

verdictForStatus() in src/core/genlayer/contract.ts maps only
VERIFIED|PASSED|PASS -> PASS and NOT_VERIFIED|FAILED|FAIL -> FAIL, else null. A
literal third status PASS_WITH_MATERIAL_RISK would therefore parse to NO verdict
and render blank, which is why a material-risk pass keeps VERIFIED and carries
the risk in the Reason text the UI displays — never rounded up to a clean pass.

Target: studio-dev / Studio Next (chain id 61997).
"""

import json

import genlayer as gl
from genlayer.types import *  # noqa: F401,F403

# The model's three-way verdict, and the contract's own state names.
_ALLOWED_VERDICTS = ("PASS", "FAIL", "PASS_WITH_MATERIAL_RISK")
_STATUS_EMPTY = "EMPTY"
_STATUS_OPEN = "OPEN"
_STATUS_CHALLENGED = "CHALLENGED"
_STATUS_VERIFIED = "VERIFIED"
_STATUS_NOT_VERIFIED = "NOT_VERIFIED"

# Decision fields validators MUST agree on. `reason` is deliberately excluded:
# it is free-form prose and legitimately differs between nodes.
_DECISION_KEYS = (
    "verdict",
    "brief_followed",
    "requirements_met",
    "material_risk_disclosed",
    "failed_requirements",
    "missed_material_risks",
    "score",
)

_SCHEMA_HINT = (
    "Return ONLY a JSON object with exactly these keys:\n"
    "{\n"
    '  "verdict": "PASS" | "FAIL" | "PASS_WITH_MATERIAL_RISK",\n'
    '  "brief_followed": <bool>,          // did the work follow the original brief?\n'
    '  "requirements_met": <bool>,        // were the explicit requirements satisfied?\n'
    '  "material_risk_disclosed": <bool>, // were required material risks disclosed?\n'
    '  "failed_requirements": [<str>],    // explicit requirement texts the work violated\n'
    '  "missed_material_risks": [<str>],  // material-risk requirement texts left undisclosed\n'
    '  "score": "<met>/<total>",          // e.g. "3/4" — requirements satisfied\n'
    '  "reason": "<str>"                  // one sentence explaining WHY\n'
    "}\n"
    "Rules: FAIL if the work violates an explicit requirement. "
    "PASS_WITH_MATERIAL_RISK if the work satisfies every requirement but omits a "
    "material risk the brief demanded be disclosed. PASS otherwise. "
    "Do not invent transactions, chain data, identities or evidence — judge only "
    "the material provided."
)


def _parse_json_object(raw):
    """Pull a JSON object out of whatever the model actually returned.

    `response_format="json"` normally yields a dict, but a runner may hand back
    a string, and models habitually wrap JSON in ``` fences or a sentence of
    preamble. Both are recovered here so a cosmetically noisy answer does not
    cost the network a leader rotation.
    """
    if isinstance(raw, dict):
        return raw
    text = raw if isinstance(raw, str) else str(raw)
    text = text.strip()
    if text.startswith("```"):
        # Drop the opening fence line (``` or ```json), then any closing fence.
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.rstrip()
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        # Last resort: the outermost {...} in the response.
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise Exception("adjudicator did not return a JSON object")
        return json.loads(text[start:end + 1])


def _coerce_ruling(raw) -> dict:
    """Normalize the model's response into the canonical ruling dict.

    Raises on anything malformed. That is deliberate: the leader's result then
    becomes an error, every validator returns False, and the network rotates to
    a new leader instead of persisting a bogus verdict.
    """
    obj = _parse_json_object(raw)
    if not isinstance(obj, dict):
        raise Exception("adjudicator did not return a JSON object")

    verdict = str(obj.get("verdict", "")).strip().upper()
    verdict = verdict.replace("PASS WITH MATERIAL RISK", "PASS_WITH_MATERIAL_RISK")
    if verdict not in _ALLOWED_VERDICTS:
        raise Exception("invalid verdict: " + repr(verdict))

    def _bool(key) -> bool:
        value = obj.get(key, False)
        if isinstance(value, str):
            value = value.strip().lower() in ("1", "true", "yes")
        return bool(value)

    def _list(key) -> list:
        value = obj.get(key, [])
        if isinstance(value, str):
            value = [line for line in value.splitlines() if line.strip()]
        if not isinstance(value, (list, tuple)):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    return {
        "verdict": verdict,
        "brief_followed": _bool("brief_followed"),
        "requirements_met": _bool("requirements_met"),
        "material_risk_disclosed": _bool("material_risk_disclosed"),
        "failed_requirements": _list("failed_requirements"),
        "missed_material_risks": _list("missed_material_risks"),
        "score": str(obj.get("score", "") or "").strip(),
        "reason": str(obj.get("reason", "") or "").strip(),
    }


def _decision_fields(ruling):
    """Canonical string of the DECISION FIELDS ONLY — what validators compare.

    Lists are sorted so two nodes naming the same violated requirements in a
    different order still agree. A non-dict returns None, so a leader that did
    not return a ruling can never compare equal to a validator's real one.
    """
    if not isinstance(ruling, dict):
        return None
    normalized = {}
    for key in _DECISION_KEYS:
        value = ruling.get(key)
        if isinstance(value, (list, tuple)):
            normalized[key] = sorted(str(item).strip() for item in value if str(item).strip())
        else:
            normalized[key] = value
    return json.dumps(normalized, sort_keys=True, ensure_ascii=False)


def _status_for(verdict: str) -> str:
    """Map the model's three-way verdict onto the app's two on-chain statuses."""
    return _STATUS_NOT_VERIFIED if verdict == "FAIL" else _STATUS_VERIFIED


def _reason_for(ruling: dict) -> str:
    """Reason text for the receipt, keeping a material-risk pass distinguishable.

    PASS_WITH_MATERIAL_RISK shares the VERIFIED status, so the undisclosed risk
    is surfaced here rather than being lost.
    """
    reason = ruling.get("reason", "")
    if ruling.get("verdict") != "PASS_WITH_MATERIAL_RISK":
        return reason
    risks = ruling.get("missed_material_risks") or []
    detail = "; ".join(risks) if risks else "a material risk the brief required be disclosed"
    return ("Passed with material risk — undisclosed: " + detail + ". " + reason).strip()


class AgentRefReceipt(gl.contract.Contract):
    # Persistent state. Declared in the class body with type annotations so it
    # survives between calls. One receipt at a time, as the app expects.
    brief: str
    work: str
    evidence: str
    agent: str
    challenge_reason: str
    challenge_evidence: str
    status: str
    score: str
    reason: str

    # Constructor must stay private (no decorator). Takes no arguments, so
    # Studio's Constructor Inputs pane will show none — deploy with "{}".
    def __init__(self):
        self.brief = ""
        self.work = ""
        self.evidence = ""
        self.agent = ""
        self.challenge_reason = ""
        self.challenge_evidence = ""
        self.status = _STATUS_EMPTY
        self.score = ""
        self.reason = ""

    @gl.public.write
    def create_receipt(self, brief: str, work: str, evidence: str, agent: str) -> None:
        """Record the work under review. Clears any previous challenge/verdict."""
        self.brief = brief
        self.work = work
        self.evidence = evidence
        self.agent = agent
        self.challenge_reason = ""
        self.challenge_evidence = ""
        self.status = _STATUS_OPEN
        self.score = ""
        self.reason = ""

    @gl.public.write
    def challenge(self, reason: str, evidence: str) -> None:
        """Dispute the receipt. Requires an existing, not-yet-adjudicated receipt."""
        if self.status == _STATUS_EMPTY:
            raise gl.vm.UserError("no receipt to challenge - call create_receipt first")
        if self.status == _STATUS_VERIFIED or self.status == _STATUS_NOT_VERIFIED:
            raise gl.vm.UserError("this receipt has already been adjudicated")
        self.challenge_reason = reason
        self.challenge_evidence = evidence
        self.status = _STATUS_CHALLENGED

    def _prompt(self) -> str:
        """Build the adjudication prompt.

        Reads storage, so it must be called in DETERMINISTIC context — before
        the nondet block, never inside it.
        """
        if self.challenge_reason or self.challenge_evidence:
            challenge = (
                "Challenge reason: " + self.challenge_reason + "\n"
                "Challenge evidence: " + self.challenge_evidence
            )
        else:
            challenge = "This receipt was not challenged."
        return (
            "You are an impartial adjudicator for AgentRef, a dispute-resolution "
            "protocol for AI work receipts. A requester submitted work against a "
            "brief; a challenger may dispute it. Judge whether the submitted work "
            "followed the brief, using ONLY the material below.\n\n"
            "Brief:\n" + self.brief + "\n\n"
            "Work under review:\n" + self.work + "\n\n"
            "Evidence:\n" + self.evidence + "\n\n"
            + challenge + "\n\n"
            + _SCHEMA_HINT
        )

    @gl.public.write
    def adjudicate(self) -> None:
        """Rule on the receipt by GenLayer validator consensus.

        The leader and every validator each run the LLM independently; the
        ruling is accepted only when their decision fields agree.
        """
        if self.status == _STATUS_EMPTY:
            raise gl.vm.UserError("no receipt to adjudicate - call create_receipt first")

        # Storage read BEFORE entering the nondet block.
        prompt = self._prompt()

        def judge() -> dict:
            # Nondet block: the LLM call and nothing else. No storage access,
            # no contract calls, no emits, no nested nondet blocks.
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _coerce_ruling(raw)

        def validator(leader_result) -> bool:
            # A leader that errored arrives as a UserError/VMError wrapper, not
            # a Return — that must never count as agreement.
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_fields = _decision_fields(leader_result.calldata)
            if leader_fields is None:
                return False  # leader payload was not a ruling — never agree
            try:
                mine = judge()
            except Exception:
                return False
            return leader_fields == _decision_fields(mine)

        agreed = gl.vm.run_nondet_unsafe(judge, validator)

        # Consensus reached. Back in deterministic context — safe to persist.
        self.status = _status_for(agreed["verdict"])
        self.score = agreed["score"]
        self.reason = _reason_for(agreed)

    @gl.public.view
    def get_receipt(self) -> str:
        """The exact pipe-delimited line the app's parser expects."""
        if self.challenge_reason or self.challenge_evidence:
            challenge_info = "Challenge: " + self.challenge_reason + " | " + self.challenge_evidence
        else:
            challenge_info = "No challenge"
        return (
            "Status: " + self.status
            + " | Agent: " + self.agent
            + " | Brief: " + self.brief
            + " | Work: " + self.work
            + " | " + challenge_info
            + " | Score: " + self.score
            + " | Reason: " + self.reason
        )
