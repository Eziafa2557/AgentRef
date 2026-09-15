# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import genlayer as gl
from genlayer.types import *


class AgentRef(gl.contract.Contract):
    brief: str
    work: str
    evidence: str
    agent: str
    challenge_text: str
    status: str
    reason: str

    def __init__(self, brief: str = "", work: str = "", evidence: str = "", agent: str = "", challenge_text: str = "", status: str = "EMPTY", reason: str = ""):
        self.brief = brief
        self.work = work
        self.evidence = evidence
        self.agent = agent
        self.challenge_text = challenge_text
        self.status = status
        self.reason = reason

    @gl.public.write
    def create_receipt(self, brief: str, work: str, evidence: str, agent: str) -> None:
        self.brief = brief
        self.work = work
        self.evidence = evidence
        self.agent = agent
        self.challenge_text = ""
        self.status = "OPEN"
        self.reason = ""

    @gl.public.write
    def challenge(self, reason: str, evidence: str) -> None:
        if self.status == "EMPTY":
            raise gl.vm.UserError("no receipt")
        self.challenge_text = (reason + " -- " + evidence) if evidence else reason
        self.status = "CHALLENGED"

    @gl.public.write
    def adjudicate(self) -> None:
        if self.status == "EMPTY":
            raise gl.vm.UserError("no receipt")
            
        prompt = (
            "Decide whether the WORK followed the BRIEF, taking the CHALLENGE "
            "into account. Answer with one word: PASS or FAIL.\n"
            "BRIEF: " + self.brief + "\n"
            "WORK: " + self.work + "\n"
            "EVIDENCE: " + self.evidence + "\n"
            "CHALLENGE: " + (self.challenge_text or "(none)")
        )

        def judge() -> str:
            return gl.nondet.exec_prompt(prompt)

        answer = str(
            gl.eq_principle.prompt_non_comparative(
                judge,
                task="Decide whether the work followed the brief",
                criteria="One word, PASS or FAIL, consistent with the brief, work and challenge.",
            )
        ).strip().upper()

        passed = "PASS" in answer and "FAIL" not in answer
        self.status = "VERIFIED" if passed else "NOT_VERIFIED"
        self.reason = "GenLayer validator consensus: " + ("PASS" if passed else "FAIL")

    @gl.public.view
    def get_receipt(self) -> str:
        challenge_str = ("Challenge: " + self.challenge_text) if self.challenge_text else "No challenge"
        score = {"VERIFIED": "1/1", "NOT_VERIFIED": "0/1"}.get(self.status, "")
        return (
            "Status: " + self.status + " | Agent: " + self.agent
            + " | Brief: " + self.brief + " | Work: " + self.work
            + " | " + challenge_str + " | Score: " + score + " | Reason: " + self.reason
        )
