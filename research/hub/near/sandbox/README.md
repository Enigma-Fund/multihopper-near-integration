# NEAR sandbox lifecycle stage

Repository **MultiHopper1/multihopper**, branch **enigma/near-sandbox-lifecycle-20261104**, base **2af61d3ed9b4d61104412764ade0e1e59bb2b34b**. Exact tested commit/results: [RESULTS.md](RESULTS.md).

This stage runs the compiled authorization contract and two synthetic token fixtures on **nearcore sandbox 2.14.0**, protocol 88. Calls are real Ed25519-signed local transactions; the client waits for `FINAL`, including finalized receipts, before accounting for outcomes. Contract identity, predecessor authorization, block timestamps, Borsh persistence, WASM execution, token balance changes and restart behavior are exercised by the node. The earlier MockedBlockchain tests remain regressions, not substitutes for this gate.

No public chain, production API, deployed product, real wallet, real asset or MPC signer is involved. Contract installation and synthetic transactions happen only on a disposable local chain. The native NEAR balances used for account setup/gas are genesis-generated test coins. Test accounts have deliberately public deterministic fixture keys, which must never be reused for real assets.

## Custody and execution

- `treasury.synthetic` stores bounded policies and reservations. It holds no payment tokens.
- `usd.synthetic` / `native.synthetic` are deliberately minimal **synthetic token test contracts**, not audited/full NEP-141 implementations. Their balances are indexed by separately owned accounts, like ordinary token ledgers; no shared user custody address is used.
- Each user/asset/chain-policy position maps to a distinct `v<hash>.synthetic` account. The coordinator refuses address collisions and verifies existing account keys/code before resuming setup. Each account has a separate synthetic signing key; the agent identity does not possess the custody key through an application interface.
- Owners fund their assigned account. Payments leave that account for the ordinary recipient. Recovery returns its remaining principal to the original owner. There is no intermediate pool, swap, liquidity provider or cross-user netting.
- Principal is tracked independently of observed token balance. The unsolicited-deposit test puts 900 extra units beside 20 rightful units, then verifies recovery returns only 20 and leaves 900 uncredited. This demonstrates accounting isolation, not physical prevention of unsolicited transfers on public token accounts.
- Native sandbox gas is prefunded separately from synthetic-token principal. There is no sponsor rotation or privacy delay; we did not implement NEP-366 meta-transaction sponsorship or measure production economics.

The chain label in a policy remains a namespace under test. These synthetic tokens all execute on the **local NEAR chain**. This does not establish actual Base, Solana, Ethereum, BNB, Robinhood or Arbitrum settlement.

## Recovery across independent commits

The local coordinator and NEAR contract are independent durable state stores. A SQL transaction cannot roll back a confirmed chain transaction. The sandbox coordinator therefore persists an immutable intent **before** calling the chain, and reconciles chain state after interruption:

1. Persist a payment's `authorizing` intent and reserve local principal. Call the real policy contract. If the worker dies before acknowledging the grant, a retry uses the same owner-scoped payment ID and cannot reserve twice.
2. Transfer with a fixed operation ID and binding. The token fixture records an immutable result on-chain. A worker death after token settlement is reconciled from that result, without sending a second payment.
3. Finalize the policy reservation. A death between policy finalization and local principal update also reconciles idempotently.
4. Freeze the position locally and revoke the policy on-chain before recovery. An unavailable node leaves the position frozen and principal reserved.
5. Reconcile delivered payments, or obtain the token fixture's atomic cancellation record for unexecuted ones. A delayed transfer carrying the same operation ID then returns `cancelled`.
6. Persist the recovery intent and transfer only remaining principal to its original owner. A process death after the refund cannot create a second refund.

The cancellation fence is **real execution of a custom fixture contract on this local node**. It is not a capability claimed for existing NEP-141/SPL/ERC20 tokens. That distinction remains a production gate: external chains need an enforceable nonce/expiry/finality scheme, otherwise unresolved payments must stay blocked.

Coordinator operations use a fail-closed single-worker lease plus SQLite durable commits. A dead worker's lease can be reclaimed after verifying the recorded PID no longer exists; an ambiguous/live lease is refused. This is local recovery research, not distributed consensus, high availability, or tamper-proof storage. A compromised database/coordinator/custody signer is outside the established security boundary.

## Run and confinement

```sh
# Native regressions and real local sandbox, recorded in the hub:
python3.12 research/hub/run.py near

# Real sandbox gate alone:
python3.12 research/hub/near/sandbox/run.py
```

The runner verifies [runtime pins](RUNTIME.json), reviewed Cargo dependencies, the nearcore binary and isolated WASM standard-library files. It compiles with `--offline --locked`, `--cfg near` and a temporary WASM sysroot. No toolchain installer or npm dependency is run. Missing/changed inputs fail closed; test execution never downloads replacements.

Compilation/native tests use a deny-network OS sandbox. The node and local client use `local-only.sb`, allowing loopback only and denying existing wallet configuration paths. RPC and peer addresses bind to `127.0.0.1`; bootnodes, STUN, telemetry and outbound peers are disabled. The RPC client has no arbitrary endpoint setting and refuses signing unless the node reports the exact random synthetic chain ID. The allowed RPC methods are local status/query/send/status operations.

Each run creates fresh genesis state, installs WASM locally, runs tests, stops the node, and removes its temporary state/keys. Restart tests reuse that run's state only. No fetched contract code, mainnet state import, sandbox patch-state balance manipulation after startup, live product credentials or production migrations are used.

## What changed after running real WASM

- Optimistic completion allowed stale access-key nonce reads. The local client now requests `send_tx` with `wait_until: FINAL` and explicitly verifies finality before accounting. No timeout is interpreted as failure/refund permission.
- The SDK requires `--cfg near` for its NEAR host error path. Initial WASM builds without it produced generic traps on rejected operations. The corrected build retains precise rejection assertions in the tests.
- Policy authorization and local journaling could no longer be modeled as one atomic transaction. The sandbox coordinator uses durable intent states and idempotent chain reconciliation across that gap.
- Recovery and policy/account setup have explicit retry bindings; repeated transfers, changed recipients/amounts, conflicting resolutions and funding replays are rejected or return the original result.

## Still required before production

No production readiness or new privacy benefit is claimed. Remaining work includes audited WASM storage/gas limits and migrations; real wallet/session authentication; restricted custody key-provider or MPC integration; grant-bound signing enforced beyond a trusted coordinator; actual NEP-141/token-extension support; cross-chain transaction encoding, finality/reorg proofs and cancellation; multi-instance durable storage and rollback protection; deployment/upgrade governance and independent security review. The fixed resolver is a trusted synthetic actor, not an aggregate on-chain proof of external settlement.

The earlier [native prototype release-gap list](../README.md) still applies except that local WASM/node lifecycle execution is now exercised. Running a real local node does not close MPC, public-network, ordinary-token compatibility or production privacy gaps.

Sources consulted for implementation: [official NEAR sandbox](https://github.com/near/near-sandbox), [NEAR transaction finality semantics](https://docs.near.org/api/rpc/transactions). See [static intake review](INTAKE.md) for exact revisions and review limitations.
