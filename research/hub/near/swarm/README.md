Repository **MultiHopper1/multihopper**, branch **enigma/near-swarm-demo-20261104**, base `a0ad4b55229e017d211c57395f289701364b1a48`. Tested revision and results: [RESULTS.md](RESULTS.md).

# Swarm-for-Hire: separate job treasuries

MultiHopper contributes the money-control layer: separate customer/agent custody, bounded payment authority, durable duplicate prevention, and reconciliation before returning unused principal. It does not decide whether an agent's work is correct. NEAR supplies the locally executed authorization contract and token ledger. This demo uses scripted agents, synthetic ordinary-token interfaces and a disposable loopback-only nearcore node.

[Open the recorded interactive demo](../../results/near-swarm-20261104/demo.html). It replays actual test snapshots, has no network dependencies and cannot submit transactions.

## Custody map

| Customer | Job budget | Researcher custody | Reviewer custody |
|---|---:|---:|---:|
| Alice | 100 | Separate account/key: 60; payment cap 25 | Separate account/key: 40; payment cap 20 |
| Bob | 100 | Different account/key: 60; payment cap 25 | Different account/key: 40; payment cap 20 |

No allocation borrows from another slot or customer. Allocations are fixed and sum exactly to the job budget; no automatic reallocation or delegation is implemented. Same-asset funds from different customers never share a controlled custody account. Merchant settlement ends customer custody: receipts become merchant-owned funds, not a pooled job treasury. Public accounts can receive unsolicited transfers; these do not enlarge recognized principal or refunds.

Alice spends 20 + 10, fails and recovers 70. Bob's 100 remains untouched, then Bob spends 25 + 15 and recovers 60 on completion. These are synthetic token units, not NEAR or USD valuations.

## Enforcement and recovery

- Each allocation binds owner, agent, token, recipient, expiry, lifetime budget and per-payment cap in the existing on-chain policy. The separate software provider verifies that policy before signing.
- An independent SQLite database holds the OS writer lock for each worker/provider lifetime, released automatically on process death; there is no PID-file takeover race. Separate SQLite journals persist job plans and immutable customer-scoped invoice bindings before external side effects. Duplicate/restarted requests reconcile the same grant and signed transaction.
- Job failure freezes new coordinator payments, revokes every allocation, then reconciles and refunds principal. Revocations across allocations are sequential, not atomic; already-signed transfers may still land and must be reconciled first.
- Partially funded jobs recover existing deposits without starting missing deposits. Zero-principal policies still cancel outstanding grants. Unknown transaction outcomes block recovery rather than authorizing a second spend.
- The synthetic owner/agent identities passed to the harness are not production user authentication. No public job API is exposed.

## Privacy work and decisive limit

Job titles/prompts and invoice text are kept out of payment memos. Grant identifiers are opaque hashes; these are data-minimization measures, not cryptographic hiding of ownership or policy fields. On-chain owners, agents, recipients, amounts and token-account relationships remain public. The simple sponsor is unchanged. No artificial delays, account rotation or extra hops are added for privacy.

A separate deterministic observer process receives only public block/chunk transactions and successful token transfers captured across the visible demo interval. Truth labels and job/provider state are supplied only to the scorer afterward. Raw signatures and deployed WASM bytes are omitted from the exported corpus; all signers, receivers, public keys, nonces and decoded function calls remain available. No account-state-diff or generic receipt-graph completeness claim is made: the standard token call graph already suffices for attribution here.

This is a protocol-aware public-data reverse-tracing test, not an independently blinded human/LLM cold-start investigation. It measures unique source reconstruction, not discovery time or AI-credit cost. Treat a 4/4 attribution result as a failed privacy gate. Separate custody is not anonymity.

The next privacy candidate must hide authorization and account-relationship disclosures **and** entry/exit amount correlations, while preserving actual separate custody. NEAR confidential execution/Intents is not integrated or assumed segregated. Any adapter must first prove its custody map and pass low-volume/distinctive-amount public-history tests; simply routing this demo through pooled Intents custody would violate the constraint.

## Reproduce locally

Run from the app repository:

```
python3.12 research/hub/run.py near
sandbox-exec -f research/hub/near/offline.sb python3.12 -m unittest discover -s research/hub -p 'test_*.py' -v
```

For focused Swarm debugging: `python3.12 research/hub/near/sandbox/run.py --swarm-only`.

The runner verifies previously reviewed dependency/runtime hashes, compiles offline, and confines nodes/providers to loopback networking. Generated historical regressions go under this stage's results directory. Node retention is extended only on the disposable test chain so the public corpus cannot silently omit pruned blocks.

## Production gaps

This is an isolated demonstration, not a released marketplace or audited custody service. Needed before production: authenticated owner/agent sessions; protected grant-enforcing HSM/MPC signing; rollback-resistant durable state and distributed fencing; independently verified settlement resolution; bounded/paginated contract storage; adapter review for each real token; operational recovery for permanently unknown outcomes; work acceptance/dispute policy. The same-user local host can access software keys and journals. A successful test does not establish resistance to that compromise. Chain labels (including `base`) remain namespaces on this local NEAR fixture; no assets are bridged. No cross-chain settlement, paid inference, bid matching, production integration or privacy breakthrough is claimed.
