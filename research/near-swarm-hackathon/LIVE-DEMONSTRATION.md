# Swarm for Hire: two-chain live demonstration

Updated November 17, 2026. **NEAR mainnet deployment, job creation and first invoice reservation and Solana keeper funding finalized; agent payout, recovery and finished recording remain pending.**

## Overnight readiness check — November 17, 22:09 UTC

The hosted workspace now uses the authenticated Solana connection already configured in the published MultiHopper client. It is stored only as an isolated server secret and ignored local operator configuration, not in the public integration source. Existing API credentials, NEAR publisher configuration and job storage were preserved. Core Solana programs and production API code were not changed.

- Hosted checks pass: API authenticated, provider registered, NEAR contract verified, finalized wallet history available, notification subscription active. Previously, the public providers returned HTTP 403/429 for historical reads from the hosted app. Account lookup alone did not reveal that failure; readiness now checks history as well.
- The local approval helper uses the same verified connection. Background health refresh no longer temporarily disables a working payment button. Actual payment admission still checks signed terms, current state, transaction contents and cost limits.
- All **85** integration, wallet and signing regression tests pass; no tests were skipped. The finalized-history snapshot is shared only within one request, never across requests or for mutable state or submissions. Legacy requests cannot enable batch behavior by adding an unsigned flag.
- Read-only chain reconciliation checked every saved unexecuted transaction: **five expired messages, complete finalized history, zero executions found**. The first keeper funding remains finalized and recorded. No replacement invoice, second funding, signing or payment broadcast was performed during these checks.
- Source balance at finalized slot 470694134: **0.158377104 SOL**. The agent balance remained **0 SOL**. API transfer **264** remained `deploying`, with gross 0.0025 SOL, quoted net 0.002487562 SOL and `canRescue: false`. Do not describe this as a completed payout or an available refund.

The existing invoice is restored in the browser. Resume with **Approve payment**: one scoped message review and one batch review for the remaining wallet transactions. These real wallet confirmations remain the owner's actions. Transactions are refreshed after authorization, so an overnight pause does not require funding again or keeping an expiring unsigned transaction alive. Initial job setup and later NEAR receipt publication are separate; the two-review count refers to the already-linked invoice's Solana payment.

Evidence: `evidence/overnight-readiness-20261117.json`, `evidence/overnight-api-status-20261117.json` and `evidence/overnight-reconciliation-20261117.json`. The latest isolated Pages release is `0a00ad4d-b157-4dbd-8988-8aba61593467`. Live payout, TRM-linked settlement evidence, NEAR settlement publication, live refund and finished recording still require completion; none is inferred from passing tests.

## Verified live progress

- All three requested accounts were funded: 3.02 NEAR contract balance, 0.11 NEAR operations balance and 0.178857080 SOL in the previously registered authority selected by its owner for this demo.
- The owner approved deployment and initialization of the dedicated NEAR contract. Transaction: [DMCxAvDeotyH33F4M512BQEShwNgCYYEvNSU1zgQsaWM](https://nearblocks.io/txns/DMCxAvDeotyH33F4M512BQEShwNgCYYEvNSU1zgQsaWM). Final execution and every receipt succeeded.
- Contract: `9bf2f9014058da04b48e6010929fd3045f5507a452ec9acaa8b0a44c42531a0d`. Deployed executable hash: `2ziwpNEyFnCCLt63hxD8BEgJvFPe5GwcLGk5D2gRvzss`. Initialization and code were independently read at finality. Exact evidence is in `evidence/near-mainnet-deployment-20261117.json`.
- Deployment receipts report 0.0020152893264648 NEAR burned in fees. The 253,993-byte account uses approximately 2.53993 NEAR of storage reserve. That reserve remains in the account; it is not a network fee. Post-deployment total balance: 3.0179847106735352 NEAR.
- The isolated Cloudflare workspace authenticates with the Solana API, verifies the registered provider, verifies the deployed NEAR registry and has a valid notification subscription. No existing Solana program was changed or redeployed.
- A separate receipt-only key was generated inside the Cloudflare configuration operation and stored as a server secret. Its public key is `LVC57vFeTVEYH/pH5qToTj6Y+ufTxHDWmhFavUeekmI=`. It cannot sign as any funded account. The earlier local receipt key was not exported or used to initialize this deployment.
- The dedicated demo wallet connects through an opt-in loopback approval window. Funded-account keys remain in macOS Keychain. Native confirmations are required for signatures. The ordinary public wallet flow remains available without this local connector.
- Work order `d2defcee-f7d7-4e14-bd1e-368548549768` was signed and saved with a 0.005 SOL budget and a 0.0025 SOL invoice cap. The receiving demo-agent address is `7HYAMGkNqAdy7TXZvSk5QbacXVKxhG5p2FVXTuBaQHRR`; it has a separate Keychain identity. A signed work order is not evidence of payment.
- The first NEAR link-message signature succeeded, but the browser blocked the subsequent Solana approval popup. The demo connector now opens one review window from the user's click and reuses it for the account connection, both link signatures and NEAR transaction. It retains individual native confirmations, origin/request matching and the persisted transaction journal. Deployment `67158506-3eaf-481c-a59f-8cc59ebe114f` publishes this fix only to the separate Swarm workspace. No second contract deployment or replacement payment was submitted.
- A finalized NEAR read at block 225017614 returned no job for `swarm-live-20261117`; the workspace database also had no completed link. The Solana source still held 0.178857080 SOL at finalized slot 470680905. Approval messages alone must not be reported as on-chain job creation or payment. RPC readiness has intermittently returned `unknown` from the hosted workspace even though the same provider lookup verifies registration locally; payment remains subject to successful live checks.
- Subsequently, job creation finalized in [HazXxjr9mdKozowtaFF7B5LPKmaeqpjPAXaDP4GXRQpa](https://nearblocks.io/txns/HazXxjr9mdKozowtaFF7B5LPKmaeqpjPAXaDP4GXRQpa). Its 0.005 SOL budget, 0.0025 SOL per-payment limit and signed terms hash match the work order. Storage contribution: 0.01 NEAR; receipt-summed network fee: 0.0002051905845554 NEAR. The website now shows the completed link.
- Invoice `agent-brief-01` was reserved in [EhXntANRHFBaGDeZmVReJjaGgnK3GAW6MJARydEFbqcr](https://nearblocks.io/txns/EhXntANRHFBaGDeZmVReJjaGgnK3GAW6MJARydEFbqcr). Storage contribution: 0.02 NEAR; network fee: 0.0002266457566536 NEAR. The Solana API created transfer 264 for this same invoice and quoted 0.002487562 SOL to the agent from 0.0025 SOL gross. A reservation is not a payout.
- The first prepared Solana transaction failed its unsigned preflight with `BlockhashNotFound`; it was not signed or broadcast. The repaired browser flow completes both authorization messages before preparing expiring transactions, then rechecks the exact next step before each signature. Expired transactions are renewed only through the existing finalized-history reconciliation guard. Unsigned preflight failures return directly to the website; ambiguous failures after signing retain the saved request for reconciliation. Deployment `8907f5e2-8797-41cc-aff0-33441b704482` contains this update only in the dedicated integration workspace.

- Hosted RPC reads subsequently failed intermittently. Deployment `6a257891-5a5c-49ad-a0a1-afe4372f7df0` adds one bounded retry for transient read failures and safe method/error-code diagnostics. Finalized-history, network and duplicate-payment checks remain mandatory. Public source history at finalized slot 470687118 contained no transaction after the payment preparation slot 470684410, and the persisted batch had no submitted step. The same invoice was resumed; no replacement invoice or NEAR reservation was created.


- The user subsequently approved the first Solana funding transaction: [g2dqRT1T4LLhuQAe8sTXHSC9UJy5gSfex4LFqGUuBKpK9JweVhuG527z62jTW5JPSwK7kSG2XpVWKvEsDSahfjw](https://solscan.io/tx/g2dqRT1T4LLhuQAe8sTXHSC9UJy5gSfex4LFqGUuBKpK9JweVhuG527z62jTW5JPSwK7kSG2XpVWKvEsDSahfjw). Finalized slot 470688366; keeper credit 0.020474976 SOL, network fee 0.000005 SOL, source debit 0.020479976 SOL. This is route funding, **not an agent payout**. Public receipt: `evidence/solana-keeper-funding-20261117.json`.
- The following step could not be renewed by comparing only a normalized message hash. The existing API can generate a new ephemeral route-token mint and rebase an uninitialized route schedule. The integration now renews the whole unexecuted suffix only after every earlier message has expired and complete finalized history rules out execution. Confirmed funding is retained; a replacement bundle that asks for that keeper funding again is rejected.

## Streamlined payment approval

For an existing quoted, NEAR-linked invoice, the batch-capable path requests **one scoped invoice message and one transaction batch**. The local demo wallet presents the remaining transactions in one native confirmation; compatible Wallet Standard wallets receive one variadic signing request, with their own confirmation UI. Initial wallet connection, new-job creation and NEAR receipt publication are separate operations; this change does not claim they disappear.

Every signed transaction is validated and stored before execution. The gateway then simulates and submits each step in order, enforces the cumulative invoice/cost limit and resumes the saved signatures after a lost response. It does not batch the downstream routing hops into one transaction or change their schedule. The tests cover duplicate funding, lost staging/broadcast responses, tampered/co-signer signatures, cumulative-cost failure, unavailable history, and concurrent job closure. The native helper compiled successfully. Deployment `8cdabb91-92c3-4cf3-8f02-70ecc76866f3` serves this flow in the isolated Swarm workspace. The new batch's actual live approval and remaining payout are still pending.

The last two-route quote plus provider reserve totals 0.180486770 SOL, which exceeds the verified balance by 0.001629690 SOL. The first route is covered. Do not count potential rent recovery as spendable before it is finalized, and do not silently reduce route settings to fit a budget.

## What is implemented

A dedicated NEAR contract records customer-owned job terms, spending limits, invoice reservations, closure and authenticated payout/refund receipts. The website prepares unsigned NEAR transactions for Meteor and independently verifies the returned transaction hash. Solana wallet approvals use the existing authenticated MultiHopper API and the signed invoice. The integration verifies finalized Solana payouts and the MultiHopper screening proof before recording a paid invoice. Recovery requires the exact route-specific prepared recovery messages and a finalized credit to the owner.

The NEAR receipt publisher is an explicit trust dependency: it authenticates our verification of Solana evidence. This is not a light-client bridge or a TRM-issued certificate. The NEAR job registry does not custody the Solana payment principal, add a bridge, or change production Solana custody. A reserved invoice consumes its original gross authorization on either payout or refund. An agent cannot gain another allowance by replaying a refunded invoice.

## Funding plan

This is a **bounded starting balance**, not a promise of exact fees. Native NEAR and native SOL suffice; no USDC, PYUSD or bridge liquidity is needed.

| Account/purpose | Target starting allocation | Basis |
|---|---:|---|
| Dedicated NEAR contract account | 3 NEAR | 253,723-byte WASM; code storage alone is approximately 2.53723 NEAR at 10^19 yoctoNEAR/byte; margin for account state and deployment gas |
| Dedicated NEAR operations account | 0.1 NEAR | 0.01 NEAR/job, 0.02 NEAR/invoice; two jobs/two invoices consume 0.06 NEAR storage contributions, plus gas |
| Previously funded Solana service wallet, selected by its owner for this demo | 0.20 SOL plus the provider reserve | Two gross 0.0025 SOL routes, last 7-hop quote 0.089918265 SOL up front each; remaining margin 0.02016347 SOL |
| Existing Solana integration/provider authority | No additional allocation requested at this stage | Provider already registered; finalized observed balance 0.038857080 SOL, separate from the customer's payment budget |

The retained NEAR storage contributions are not payment principal and are not automatically refunded. NEAR code storage is locked balance, not burned gas. The last Solana quote included 0.019984720 SOL identified by the API as potentially refundable and estimated net agent delivery of 0.002487562 SOL from a gross 0.0025 SOL charge. Reclaimability depends on actual settlement and is not counted as available funding for the second exercise. Refresh the quote and both customer balances before wallet approval. The additional amount to fund is the target minus the customer's existing spendable balance; the owner has now selected the existing Solana service wallet, and two dedicated NEAR implicit identities have been generated and verified locally. The exact public addresses, finalized balance snapshot and additional funding amounts are in the local funding plan; private keys remain in macOS Keychain.

The dedicated NEAR contract and operations identities have separate keys. Funding created both implicit accounts; the deployment above initialized the contract atomically. The publisher uses a third identity that cannot sign as either account. The existing Solana provider authority is used for this demonstration at its owner's explicit instruction. Retain the provider's minimum reserve. No existing account's code was overwritten.

## Demonstration sequence

1. Deploy the isolated NEAR contract on the new dedicated account, with the pinned publisher key and `mainnet` domain. Verify executable hash and configuration using finalized RPC reads. Configure only the integration workspace.
2. Customer signs a work order for a concrete agent task: summarize three provided public NEAR ecosystem resources and produce a short cited brief. Display the agent's actual output, signed work-order limits and NEAR reservation. A supervised software agent can draft and submit an invoice; the customer's wallet authorizes expenditure.
3. Customer approves a gross 0.0025 SOL invoice. Follow the production API route to a finalized payout. Independently verify the recipient credit and screening proof; publish the receipt to NEAR. Capture both chain transaction links and exact fees.
4. Second job exercises failure. Closing an unfunded job is **not a refund**. Production rescue is available only for a route that the actual API reports as recoverable with positive recoverable funds. Do not deliberately fail AML screening, interfere with the keeper, or fabricate a refund. If no safe route-specific interruption is supported, show the validated local interrupted-recovery test as local evidence and report live refund as pending; do not substitute a direct repayment and call it recovery.
5. Retry the same invoice/receipt and show no additional payment. Close the NEAR job and verify no further reservations can be admitted. Existing authorized settlements remain reconcilable.

## Evidence and recording

Record the actual website, wallet prompts approved by the user, agent task/output, NEAR job/reservation, Solana payout/refund and final NEAR receipt. Never record seed phrases, private keys, API credentials or unrelated browser tabs. Use a dedicated browser window. Keep an uncut original and a short captioned social cut. Accelerated waiting must be labelled; local/synthetic scenes must be labelled separately from mainnet scenes.

Save the following for each invoice: UTC timestamps, network, contract address and code hash, work-order and invoice commitments, NEAR transaction hashes, Solana signatures, finalized slots/blocks, recipient/refund net credits, network fees, screening verification result, and receipt evidence hash. Hash the video and evidence manifest. A short demonstration is not a stress test: report counts, concurrency, elapsed time and failures only for work actually executed.

## Verification completed

- Compiled the dedicated NEAR registry offline using already reviewed dependencies.
- Real local NEAR contract: 31 transactions; 14 rejected attack/error cases; owner/agent limits, cross-customer separation, duplicate invoices, tampered/domain-mismatched receipts, restarts and finalization.
- Real local NEAR plus local Solana validator: two invoice reservations, one payout, one interrupted recovery, both receipt publications, restart, duplicate-publication retry and API-driven NEAR closure.
- All 85 gateway, wallet and local signing regression tests pass. The suite includes signed-work-order tampering, duplicate credits, lost responses, wrong-chain/code/publisher configuration, exact finalized NEAR transaction verification, canonical message compatibility, concurrent approval exclusion, persistence before broadcast, the full link-signing sequence when the browser refuses additional popups, and transaction freshness after message approvals. The tests distinguish an unsigned preflight rejection from an ambiguous signed request and verify that resuming confirmed/pending steps does not request another transaction signature. Synthetic regressions are not proof of a completed mainnet payment.
- Disposable Chromium popup tests pass for success, lost response/window close and rejection. Wallet pages were intercepted synthetic fixtures; no external wallet or blockchain call was made.
- Meteor web messaging reviewed against `@meteorwallet/sdk` 3.24.1. This adapter loads no SDK scripts. A user's actual funded wallet approval and mainnet lifecycle remain to be verified.

## Remaining live requirements

Complete the Solana wallet payment for the already-finalized NEAR invoice; verify the resulting payout and screening proof; publish and independently verify the NEAR receipt. A live refund additionally needs an actual recoverable route with positive funds, not a fabricated repayment. Then finish the website recording and attach both-chain receipts. These local Keychain identities use the supervised demo connector; they are not imported into Meteor. The existing production API is consumed unchanged. No core source is included in the public integration release.
