# AgentRef — demo guide (~2 minutes)

AgentRef is built to be *unscripted*: the challenger composes their own dispute,
and the adjudicator decides. The seeds below are realistic starting points with
a **bundled suggested dispute** so a judge can experience the full loop in about
a minute without typing — or improvise their own and get a real, different
outcome.

## Setup

```bash
npm install
npm run dev        # → http://localhost:3000
```

Works best in a phone-sized window (the UI is mobile-first). No wallet or
network needed — every ruling below is the honest `SIMULATED` path, clearly
labelled.

---

## Walkthrough A — the PASS scenario (60–90 s)

1. **Landing page** shows three scenarios. Tap **“Seed demo”** on
   *“Passes the brief”* (Solis Research / Arcadia Capital, $5,000 escrow). This
   loads the receipt and drops you straight into the **challenge composer**.
2. Tap **“Pre-fill with this demo’s bundled dispute”** — the challenger argues
   the downside disclosure was boilerplate. Note the evidence box is filled with
   the *exact disputed passage*.
3. Tap **“Freeze this challenge on the record.”** You land on the receipt
   detail: status is now **CHALLENGED**, the amber timeline shows the dispute,
   and each evidence item shows its content hash.
4. Hit **“Send to adjudicator.”** The verify page snapshots the payload
   fingerprint, then runs. Watch the honest staged progress — the second step
   literally reads **“SIMULATED — local rules model / no GenLayer validators
   contacted.”**
5. Verdict: **PASS**. The reason quotes what the model checked. The record now
   shows a two-step settlement log — **PASSED** then **RELEASED (simulated)**.
6. Scroll to **Content integrity** → **Verify integrity** → every hash checks.
   This is the whole point: the record is auditable end-to-end.

## Walkthrough B — the FAIL scenario (~60 s)

1. Back on `/`, seed *“Violates an explicit rule”* (Apex Quant Desk, $8,000).
2. Pre-fill the suggested dispute: the work **recommends a 3x leveraged long
   via ETHUSDT perpetual futures** for a client whose brief said *do not
   recommend leverage or derivatives of any kind*.
3. Submit and send to adjudicator.
4. Verdict: **FAIL**. The red ruling explains *why* (explicit requirement
   violated), escrow settles **LOCKED (simulated)**, and the record stays fully
   visible — nothing disappears when you lose.

## Walkthrough C — the MATERIAL RISK scenario (~60 s)

1. Seed *“Misses a required material risk”* (Northstar Advisors, $3,000). The
   brief demands a clear BTC recommendation **and clear disclosure of downside
   risks** for a conservative client.
2. Pre-fill: the advice is all upside — no downside risk is ever disclosed.
3. Adjudicate → **PASS WITH MATERIAL RISK**: it passed the explicit task but the
   missed risk disclosure is flagged on the record and the release is
   *qualified* with that risk called out.

---

## Make it yours (the honest part)

The composer is real. Change the reason, drop your own evidence text, or edit
the brief on `/create` and mint a brand-new receipt — the adjudicator re-judges
your actual material. Because the model is deterministic and inspectable
(`src/core/evaluate.ts`), you can predict roughly how it will rule and then
check that the stated reasoning matches what it looked for.

**Where is GenLayer in all this?** Every ruling above is tagged SIMULATED — the
UI says so, on purpose. To see the real path: deploy `genlayer/contract.py`
(see `genlayer/README.md`), set the env in `.env.local`, install `genlayer-js`,
and the verify page unlocks **“GENLAYER validators.”** Rulings then arrive with
`source: "genlayer"` and carry contract/transaction provenance.

**Public receipts:** on any record tap **Public link** (share icon) → it copies
`/r/[id]`. Open it: the same immutable, read-only record — integrity check
included.
