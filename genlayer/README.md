# AgentRef × GenLayer — real verification path

AgentRef's core rule: **never fake validator consensus.** Out of the box the app
runs a transparent, deterministic **SIMULATED** adjudicator
(`src/core/evaluate.ts`) — every ruling it produces is tagged
`source: "simulated"` and labelled in the UI. This directory is the **real**
path: a GenLayer Intelligent Contract that asks validator nodes to judge a
dispute and stores the consensus ruling on-chain.

```
browser (verify page)                      Node server (route handlers)
        │  fetch(/api/genlayer/submit)             │
        ▼                                          ▼
   [REAL GENLAYER adjudicator card] ──►  src/core/genlayer/runtime.ts  ──(genlayer-js@1.1.8)──►  contract.py
        ▲                                          │ signer key lives here, never in the browser   AgentRefAdjudicator
        │  fetch(/api/genlayer/ruling) ◄───────────┘                                        (validator consensus)
        ▼
   parseRulingJson → source:"genlayer" ruling, recorded on the receipt
```

## Layout

| File | Purpose |
| --- | --- |
| `genlayer/contract.py` | The Intelligent Contract (Python `gl.Contract`). |
| `genlayer/README.md` (this file) | How to deploy it for real. |
| `src/core/genlayer/config.ts` | Client-safe env reader → `not-configured` / `ready`. |
| `src/core/genlayer/runtime.ts` | **Server-only** real SDK calls (`submitDispute`, `readRuling`). |
| `src/app/api/genlayer/{submit,ruling}/route.ts` | HTTP bridge so the client never touches the SDK or the key. |

`genlayer-js@1.1.8` is a real, pinned dependency (see `package.json`) and is
imported only by `runtime.ts`. Because `runtime.ts` is server-only, its static
imports never reach the client bundle — that is what keeps the signing key and
the SDK weight off the phone.

## How the contract works

`AgentRefAdjudicator` (genlayer/contract.py) stores, per `challenge_id`:

* **`rulings`** — canonical RulingSchema JSON after validator consensus,
* **`payload_hashes`** — the SHA-256 fingerprint of the exact payload,
* **`submitters`** — the address that submitted the dispute.

`submit_dispute(challenge_id, payload_hash, payload)` runs a non-deterministic
adjudicator via `gl.nondet.exec_prompt(...)` and reaches consensus with
**`gl.vm.run_nondet_unsafe`**: the leader produces a ruling; each validator
re-runs the adjudication and accepts the leader only when the **decision
fields** agree (`verdict`, `brief_followed`, `requirements_met`,
`material_risk_disclosed`, the requirement lists). Free-form `reasoning` is
excluded from the comparison — it legitimately differs across nodes — exactly as
the official docs' resolve-match example stores non-compared `analysis`. Only
after consensus does deterministic code persist, where storage writes are
documented to be legal.

The payload handed to validators is the exact object from
`buildVerificationRequest` (`src/core/verify/request.ts`) — brief, requirements,
submitted work, challenge and evidence (with content hashes) — so validators
judge exactly the material a human would see on the receipt page. The
`payload_hash` is embedded in the stored ruling, binding the verdict to the
exact bytes that were submitted; the UI refuses to record a ruling whose hash
does not match.

## Deploy (real)

The official tools are the **`genlayer` CLI** (npm global,
`genlayerlabs/genlayer-cli`) and the hosted **Studio** at studio.genlayer.com
(web deploy, no Docker needed for remote networks; Docker is only for a full
localnet).

```bash
# 1) install the deploy CLI on the machine that holds the funded account
npm i -g genlayer
genlayer deploy --help          # confirm exact network/flag spellings for your version

# 2) get an account funded on the target network
#    faucet: https://testnet-faucet.genlayer.foundation  (~100 GEN/week)
#    export the funded key, e.g. export GENLAYER_PRIVATE_KEY=0x…

# 3) deploy the contract (exact invocation per `genlayer deploy --help`)
genlayer deploy --contract genlayer/contract.py

# 4) the CLI prints the deployed contract address — confirm it on the explorer
#    (https://explorer-bradbury.genlayer.com) and copy it into .env.local:
cp .env.example .env.local
#   NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS=0x<deployed address>
#   NEXT_PUBLIC_AGENTREF_NETWORK=testnet_bradbury
#   AGENTREF_ACCOUNT_PRIVATE_KEY=0x<funded account key>   (server-only signer)

npm run dev
```

Alternative: deploy `genlayer/contract.py` from the Studio UI
(studio.genlayer.com) and copy the address it returns. Either way, once
`NEXT_PUBLIC_AGENTREF_CONTRACT_ADDRESS` is set the UI's "REAL GenLayer
verification" card unlocks and submissions go through `/api/genlayer/submit`
(server signs + waits for finality) → `/api/genlayer/ruling` (reads `get_ruling`
at the latest FINAL round).

> **Current status (deploy blocked by one external credential):** the code path
> is complete and the full gate is green (typecheck · 56 tests · lint ·
> production build). The only thing standing between this repo and a live
> on-chain ruling is a **funded GenLayer testnet account**. That account is
> obtained exclusively through the external faucet — testnet-faucet.genlayer
> .foundation — which needs a wallet login and a small amount of mainnet ETH, a
> real external authorization this environment neither holds nor should invent.
> Once you have a funded key, the two remaining steps are one-time and
> documented above: `npm i -g genlayer` (0.39.x) on a machine with the key, run
> `genlayer deploy --contract genlayer/contract.py`, copy the printed address
> into `.env.local`, then the UI's "REAL GenLayer verification" card is live.
> Until then the app shows only the SIMULATED path and says so in the UI.

## Tests

The **unit-level** dispute logic (verdict normalization, payload hashing, ruling
parsing) is fully tested in TypeScript — `npm test`. Contract-level behaviour is
verified in the GenLayer test harness, not in this repo's sandbox:

```bash
# from a machine with the genlayer CLI / genlayer-test installed
genlayer test genlayer/contract.py          # or the harness equivalent
```

`tests/genlayer/contract.test.py` in this repo is a starting point you can drop
into that harness (see the header comment for the `@harness` call sites — note
the validator in the contract re-runs the adjudicator, so harness LLM mocks must
be set for every validator round).
