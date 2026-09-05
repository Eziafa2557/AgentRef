# {
#   "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
# }
"""
AgentRef adjudicator — a real GenLayer Intelligent Contract.

A receipt dispute is submitted as an opaque JSON `payload` (the exact bytes a
client built with `buildVerificationRequest` in src/core/verify/request.ts,
fingerprinted by `payload_hash`). The contract asks validator nodes — via the
Equivalence Principle + an LLM call — to judge whether the submitted work
followed the original brief, then stores the canonical, validator-consensus
ruling keyed by challenge id.

Consensus model (current official guidance, docs.genlayer.com): an LLM call is
non-deterministic, so `strict_eq` over the full output (including free-form
`reasoning`) would fail consensus. Instead we use `gl.vm.run_nondet_unsafe`:
the leader produces a ruling; every validator re-runs the adjudication and
accepts the leader ONLY when the decision fields match (verdict, the booleans
and the requirement lists). Reasoning text may legitimately differ across
nodes and is stored as the leader's, exactly as the docs' resolve_match example
stores non-compared `analysis`. A malformed leader result forces a rotation
(the validator returns False rather than agreeing on garbage).

Honesty contract with the app:
  * This contract produces a REAL GenLayer ruling ONLY when deployed and called
    through genlayer-js on a running network. Nothing here fakes consensus;
    when the app is not wired to a network it uses the clearly labelled
    SIMULATED path in src/core/evaluate.ts instead.
  * The stored ruling JSON mirrors RulingSchema in src/core/types.ts
    (snake_case), so the app's src/core/verify/parser.ts can consume it
    directly. The payload_hash is embedded in the ruling too, binding the
    verdict to the exact material that was sent.

Deploy: see genlayer/README.md (official CLI / Studio path).
"""

from genlayer import *  # noqa: F401,F403  (brings TreeMap, Address, gl, ...)
import json

_ALLOWED = ("PASS", "FAIL", "PASS_WITH_MATERIAL_RISK")

# Decision fields validators must AGREE on. `reasoning` and `payload_hash` are
# deliberately excluded: reasoning is free-form (differs per node) and
# payload_hash is deterministic bookkeeping added at persist time.
_DECISION_KEYS = (
    "verdict",
    "brief_followed",
    "requirements_met",
    "material_risk_disclosed",
    "failed_requirements",
    "missed_material_risks",
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
    '  "reasoning": "<str>"               # explain WHY, quoting the brief/work\n'
    "}\n"
    "Rules: FAIL if the work violates an explicit requirement. "
    "PASS_WITH_MATERIAL_RISK if the work satisfies every requirement but omits a "
    "material risk the brief demanded be disclosed. PASS otherwise. "
    "Do not invent transactions, chain data, identities or evidence — judge only "
    "the material provided."
)


def _coerce_verdict(raw) -> dict:
    """Normalize the LLM response into the canonical RulingSchema dict.

    Raises on anything malformed — a leader that returns garbage becomes an
    error result, validators return False, and the network rotates to a new
    leader instead of storing a bad ruling.
    """
    obj = raw
    if isinstance(raw, str):
        obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise Exception("adjudicator did not return a JSON object")

    verdict = str(obj.get("verdict", "")).strip().upper()
    verdict = verdict.replace("PASS WITH MATERIAL RISK", "PASS_WITH_MATERIAL_RISK")
    if verdict not in _ALLOWED:
        raise Exception(f"invalid verdict: {verdict!r}")

    def _b(key, default=False):
        v = obj.get(key, default)
        if isinstance(v, str):
            v = v.strip().lower() in ("1", "true", "yes")
        return bool(v)

    def _arr(key):
        v = obj.get(key, [])
        if isinstance(v, str):
            v = [s for s in v.splitlines() if s.strip()]
        return [str(x).strip() for x in v if str(x).strip()] if isinstance(v, (list, tuple)) else []

    return {
        "verdict": verdict,
        "brief_followed": _b("brief_followed"),
        "requirements_met": _b("requirements_met"),
        "material_risk_disclosed": _b("material_risk_disclosed"),
        "failed_requirements": _arr("failed_requirements"),
        "missed_material_risks": _arr("missed_material_risks"),
        "reasoning": str(obj.get("reasoning", "") or "").strip(),
    }


def _decision_fields(ruling) -> str:
    """Canonical string of the decision fields ONLY — what validators must agree on.

    List order is normalized (sorted) so two nodes that list the same violated
    requirements in different orders still agree. Returns None for non-dicts so a
    malformed leader result never matches a valid one.
    """
    if not isinstance(ruling, dict):
        return None
    norm = {}
    for key in _DECISION_KEYS:
        v = ruling.get(key)
        if isinstance(v, (list, tuple)):
            norm[key] = sorted(str(x).strip() for x in v if str(x).strip())
        else:
            norm[key] = v
    return json.dumps(norm, sort_keys=True, ensure_ascii=False)


def _canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


class AgentRefAdjudicator(gl.Contract):
    # Persistent state (class-body annotated fields only — see docs/storage).
    rulings: TreeMap[str, str]        # challenge_id -> canonical ruling JSON
    payload_hashes: TreeMap[str, str]  # challenge_id -> sha256 payload fingerprint
    submitters: TreeMap[str, str]      # challenge_id -> submitting address (hex)

    def __init__(self):
        pass

    @staticmethod
    def _adjudicator_prompt(payload: str, payload_hash: str) -> str:
        return (
            "You are an impartial adjudicator for AgentRef, a dispute-resolution "
            "protocol for AI work receipts. A requester submitted work against a "
            "brief; a challenger disputes it. Judge whether the submitted work "
            "followed the brief, using ONLY the material below.\n\n"
            "Material under review (payload_hash=" + payload_hash + "):\n"
            + payload
            + "\n\n" + _SCHEMA_HINT
        )

    @gl.public.write
    def submit_dispute(self, challenge_id: str, payload_hash: str, payload: str) -> None:
        """Submit a dispute. Validator consensus happens FIRST; the ONLY storage
        writes are afterwards, in deterministic context, on the agreed ruling."""
        if self.rulings.get(challenge_id, "") != "":
            raise gl.UserError("this challenge has already been adjudicated")
        # Parse check happens outside the nondet block — fail fast on a malformed
        # payload without ever contacting an LLM.
        json.loads(payload)

        prompt = self._adjudicator_prompt(payload, payload_hash)

        def adjudicate() -> dict:
            # Nondet block: LLM call only. No storage access, contract calls,
            # emits, or nested nondet blocks in here (docs: non-determinism).
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _coerce_verdict(raw)

        def validator(leader_result) -> bool:
            # Validators receive the leader's outcome wrapped in gl.vm.Return
            # (or a UserError/VMError when the leader failed).
            if not isinstance(leader_result, gl.vm.Return):
                return False  # leader failed — do NOT agree; force rotation
            try:
                mine = adjudicate()
            except Exception:
                return False
            # Compare ONLY the decision fields — reasoning text differs across
            # nodes and must not block consensus.
            return _decision_fields(leader_result.calldata) == _decision_fields(mine)

        agreed = gl.vm.run_nondet_unsafe(adjudicate, validator)

        # Consensus reached on `agreed` (the leader's ruling, whose decision
        # fields every validator matched). Deterministic context — persist.
        agreed["payload_hash"] = payload_hash
        self.rulings[challenge_id] = _canonical_json(agreed)
        self.payload_hashes[challenge_id] = payload_hash
        self.submitters[challenge_id] = gl.message.sender_address.as_hex

    @gl.public.view
    def get_ruling(self, challenge_id: str) -> str:
        """Canonical RulingSchema JSON ('' if not yet adjudicated)."""
        return self.rulings.get(challenge_id, "")

    @gl.public.view
    def get_payload_hash(self, challenge_id: str) -> str:
        return self.payload_hashes.get(challenge_id, "")

    @gl.public.view
    def get_submitter(self, challenge_id: str) -> str:
        return self.submitters.get(challenge_id, "")

    @gl.public.view
    def has_ruling(self, challenge_id: str) -> bool:
        return self.rulings.get(challenge_id, "") != ""

    @gl.public.view
    def all_rulings(self) -> dict:
        return {k: v for k, v in self.rulings.items()}
