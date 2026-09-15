# {
#   "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
# }
"""
AgentRef single-receipt adjudicator — a real GenLayer Intelligent Contract.

The surface is DELIBERATELY identical to the contract the app already speaks, so
the frontend, its parser (parseReceiptLine) and the 74 tests stay untouched:

    create_receipt(brief, work, evidence, agent)
    challenge(reason, evidence)
    adjudicate()
    get_receipt() -> "Status: … | Agent: … | Brief: … | Work: … | <challenge> | Score: … | Reason: …"

It replaces a deployment whose adjudicate() called `gl.exec_prompt(...)` — an API
the current GenVM does not have (`AttributeError: module 'genlayer.gl' has no
attribute 'exec_prompt'`). That contract could never produce a verdict, which is
why it sat at Status: EMPTY forever. It also made ONE un-consensused LLM call,
so its result was a single model opinion rather than validator consensus.

Consensus model (Equivalence Principle, current GenLayer guidance)
------------------------------------------------------------------
An LLM call is non-deterministic, so `strict_eq` over the whole response —
including free-form reasoning — would never reach agreement. Instead this uses
`gl.vm.run_nondet_unsafe`:

  * the LEADER runs `judge()` and produces a ruling;
  * every VALIDATOR re-runs `judge()` (its own LLM call) and accepts the leader
    ONLY when the DECISION FIELDS agree — verdict, the booleans, the
    requirement/risk lists and the score, order-normalized;
  * free-form `reason` is excluded from the comparison (nodes word things
    differently) and the leader's wording is the one stored — the same pattern
    the docs' resolve_match example uses for non-compared `analysis`;
  * a leader that returns malformed output makes the validator return False, so
    the network rotates to another leader instead of committing garbage.

Only AFTER consensus is reached does execution return to deterministic context
and touch storage. The nondet block reads no storage and emits nothing.

Verdict semantics
-----------------
The model is asked for the three-way AgentRef verdict — PASS / FAIL /
PASS_WITH_MATERIAL_RISK — and the contract stores the app's two-state Status:

    FAIL                     -> NOT_VERIFIED
    PASS                     -> VERIFIED
    PASS_WITH_MATERIAL_RISK  -> VERIFIED, with the undisclosed risk named in
                                Reason (the app has no third verdict state; a
                                third on-chain Status would parse to no verdict
                                at all and render as a blank result)

So a material-risk pass is never silently rounded up to a clean pass: the risk
is carried in the Reason text the UI displays.

Deploy target: Studio Next (chain id 61997), the chain this hackathon requires.
The contract source is chain-agnostic — it uses only the current gl.nondet /
gl.vm API, both of which exist on the Studio Next runtime. What is chain-
specific is the APP side: the contract address and chain key in
src/core/genlayer/contract.ts + config.ts. Deploying this file does NOT by
itself retarget the app.
"""

from genlayer import *  # noqa: F401,F403  (brings gl, TreeMap, Address, …)
import json

# The model's three-way verdict, and the app's two on-chain statuses.
_ALLOWED_VERDICTS = ("PASS", "FAIL", "PASS_WITH_MATERIAL_RISK")
_STATUS_EMPTY = "EMPTY"
_STATUS_OPEN = "OPEN"
_STATUS_CHALLENGED = "CHALLENGED"
_STATUS_VERIFIED = "VERIFIED"
_STATUS_NOT_VERIFIED = "NOT_VERIFIED"

# Decision fields validators MUST agree on. `reason` is excluded: it is
# free-form prose and legitimately differs between nodes.
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
    '  "brief_followed": <bool>,          # did the work follow the original brief?\n'
    '  "requirements_met": <bool>,        # were the explicit requirements satisfied?\n'
    '  "material_risk_disclosed": <bool>, # were required material risks disclosed?\n'
    '  "failed_requirements": [<str>],    # explicit requirement texts the work violated\n'
    '  "missed_material_risks": [<str>],  # material-risk requirement texts left undisclosed\n'
    '  "score": "<met>/<total>",          # e.g. "3/4" — requirements satisfied\n'
    '  "reason": "<str>"                  # one sentence explaining WHY\n'
    "}\n"
    "Rules: FAIL if the work violates an explicit requirement. "
    "PASS_WITH_MATERIAL_RISK if the work satisfies every requirement but omits a "
    "material risk the brief demanded be disclosed. PASS otherwise. "
    "Do not invent transactions, chain data, identities or evidence — judge only "
    "the material provided."
)


def _coerce_ruling(raw) -> dict:
    """Normalize the model's response into the canonical ruling dict.

    Raises on anything malformed: that turns the leader's result into an error,
    every validator returns False, and the network rotates to a new leader
    instead of persisting a bad ruling.
    """
    obj = raw
    if isinstance(raw, str):
        obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise Exception("adjudicator did not return a JSON object")

    verdict = str(obj.get("verdict", "")).strip().upper()
    verdict = verdict.replace("PASS WITH MATERIAL RISK", "PASS_WITH_MATERIAL_RISK")
    if verdict not in _ALLOWED_VERDICTS:
        raise Exception(f"invalid verdict: {verdict!r}")

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

    score = str(obj.get("score", "") or "").strip()

    return {
        "verdict": verdict,
        "brief_followed": _bool("brief_followed"),
        "requirements_met": _bool("requirements_met"),
        "material_risk_disclosed": _bool("material_risk_disclosed"),
        "failed_requirements": _list("failed_requirements"),
        "missed_material_risks": _list("missed_material_risks"),
        "score": score,
        "reason": str(obj.get("reason", "") or "").strip(),
    }


def _decision_fields(ruling):
    """Canonical string of the DECISION FIELDS ONLY — what validators compare.

    Lists are sorted so two nodes naming the same violated requirements in a
    different order still agree. Non-dicts return None so a malformed leader
    result can never compare equal to a valid one.
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
    return f"Passed with material risk — undisclosed: {detail}. {reason}".strip()


class AgentRefReceipt(gl.Contract):
    # Persistent state. One receipt at a time, as the app's single-receipt
    # surface expects.
    brief: str
    work: str
    evidence: str
    agent: str
    challenge_reason: str
    challenge_evidence: str
    status: str
    score: str
    reason: str

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
    def create_receipt(self, brief: str, work: str, evidence: str, agent: str):
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
    def challenge(self, reason: str, evidence: str):
        """Dispute the receipt. Requires an existing, not-yet-adjudicated receipt."""
        if self.status == _STATUS_EMPTY:
            raise gl.UserError("no receipt to challenge — call create_receipt first")
        if self.status in (_STATUS_VERIFIED, _STATUS_NOT_VERIFIED):
            raise gl.UserError("this receipt has already been adjudicated")
        self.challenge_reason = reason
        self.challenge_evidence = evidence
        self.status = _STATUS_CHALLENGED

    def _prompt(self) -> str:
        """The adjudication prompt. Reads storage — call ONLY in deterministic
        context, before entering the nondet block."""
        challenge = (
            "Challenge reason: " + self.challenge_reason + "\n"
            "Challenge evidence: " + self.challenge_evidence
            if self.challenge_reason or self.challenge_evidence
            else "This receipt was not challenged."
        )
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
    def adjudicate(self):
        """Rule on the receipt by GenLayer validator consensus.

        The leader and every validator each run the LLM independently; the
        ruling is accepted only when their decision fields agree.
        """
        if self.status == _STATUS_EMPTY:
            raise gl.UserError("no receipt to adjudicate — call create_receipt first")

        prompt = self._prompt()

        def judge() -> dict:
            # Nondet block: the LLM call and nothing else. No storage access,
            # no contract calls, no emits, no nested nondet blocks.
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _coerce_ruling(raw)

        def validator(leader_result) -> bool:
            # The leader's outcome arrives wrapped in gl.vm.Return, or as a
            # UserError/VMError when the leader failed.
            if not isinstance(leader_result, gl.vm.Return):
                return False  # leader failed — never agree; force a rotation
            leader_fields = _decision_fields(leader_result.calldata)
            if leader_fields is None:
                return False  # leader payload was not a ruling — never agree
            try:
                mine = judge()
            except Exception:
                return False
            return leader_fields == _decision_fields(mine)

        agreed = gl.vm.run_nondet_unsafe(judge, validator)

        # Consensus reached. Deterministic context — now it is safe to persist.
        self.status = _status_for(agreed["verdict"])
        self.score = agreed["score"]
        self.reason = _reason_for(agreed)

    @gl.public.view
    def get_receipt(self) -> str:
        """The exact pipe-delimited line the app's parser expects."""
        challenge_info = (
            f"Challenge: {self.challenge_reason} | {self.challenge_evidence}"
            if self.challenge_reason or self.challenge_evidence
            else "No challenge"
        )
        return (
            f"Status: {self.status} | Agent: {self.agent} | Brief: {self.brief} | "
            f"Work: {self.work} | {challenge_info} | Score: {self.score} | Reason: {self.reason}"
        )
