# AgentRef × GenLayer — real verification path

AgentRef's core rule: **never fake validator consensus.** Out of the box the app
runs a transparent, deterministic **SIMULATED** adjudicator
(`src/core/evaluate.ts`) — every ruling it produces is tagged
`source: "simulated"` and labelled in the UI. This directory is the **real**
path: a GenLayer Intelligent Contract that asks validator nodes to judge a
dispute and stores the consensus ruling on-chain.

```
src/app (client)  ──>  src/core/genlayer/adapter.ts  ──(genlayer-js)──>  contract.py
        │                      │                                                 ▲
        │   buildVerificationRequest(payload+hash)                    AgentRefAdjudicator
        ▼                      ▼                                     (validator consensus)
src/core/verify/parser.ts  ◀── get_ruling(challenge_id)  ◀──────────────────────┘
```

## Layout

| File | Purpose |
| --- | --- |
| `contract.py` | The Intelligent Contract (Python `gl.Contract`). |
| `README.md` (this file) | How to deploy it for real. |
| `src/core/genlayer/config.ts` | Reads env → `not-configured` / `ready`. |
| `src/core/genlayer/adapter.ts` | Submit dispute + read consensus ruling. |

## How the contract works

`AgentRefAdjudicator` (genlayer/contract.py) stores, per `challenge_id`:

* **`rulings`** — canonical RulingSchema JSON after validator consensus,
* **`payload_hashes`** — the SHA-256 fingerprint of the exact payload,
* **`submitters`** — the address that submitted the dispute.

`submit_dispute(challenge_id, payload_hash, payload)` runs a non-deterministic
adjudicator block that calls an LLM through `gl.nondet.exec_prompt(...)` and
harmonises validators via `gl.eq_principle.strict_eq`. Only after consensus does
deterministic code persist — exactly where storage writes are documented to be
legal. The ruling JSON mirrors `RulingSchema` in `src/core/types.ts`
(snake_case), so `src/core/verify/parser.ts` consumes it directly.

The payload handed to validators is the exact object from
`buildVerificationRequest` (`src/core/verify/request.ts`) — brief, requirements,
submitted work, challenge and evidence (with content hashes) — so validators
judge exactly the material a human would see on the receipt page.

## Deploy (real)

GenLayer has no single `deploy` command; the official flow is the
[project boilerplate](https://github.com/genlayerlabs/genlayer-project-boilerplate):

```bash
git clone https://github.com/genlayerlabs/genlayer-project-boilerplate.git gl-app
cd gl-app
# drop this contract in as the app contract, e.g.
cp <agentref>/genlayer/contract.py src/  # adjust to the boilerplate layout
# configure accounts (ACCOUNT_PRIVATE_KEY_1/2 in gltest.config.yaml)
npm i && npm run gltest  # or the boilerplate's own test/deploy scripts
```

Then point the app at the deployed address:

```bash
# in <agentref>
cp .env.example .env.local
# set NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS / _NETWORK / _CHAIN_KEY
npm i genlayer-js      # optional runtime dep — only needed for the real path
AGENTREF_ACCOUNT_PRIVATE_KEY=... npm run dev
```

## Tests

The **unit-level** dispute logic (verdict normalization, payload hashing, ruling
parsing) is fully tested in TypeScript — `npm test`. Contract-level behaviour is
verified in the GenLayer test harness, not in this repo's sandbox:

```bash
# from the boilerplate, with genlayer-test installed
pytest tests/direct/ -v
gltest tests/integration/ -v --network localnet
```

`tests/genlayer/contract.test.py` in this repo is a starting point you can drop
into that harness (see the header comment for the two `@harness` call sites).
