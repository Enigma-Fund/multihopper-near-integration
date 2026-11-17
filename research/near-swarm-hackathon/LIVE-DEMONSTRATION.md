# Swarm for Hire: two-chain live demonstration

Prepared November 17, 2026. Live demonstration status: **not yet executed**.

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

The dedicated NEAR contract and operations identities have separate keys. Neither account has been created on-chain yet; the first native NEAR transfer creates an implicit account. The publisher uses a third, unfunded identity that cannot sign as either account. The existing Solana provider authority is used for this demonstration at its owner's explicit instruction. Retain the provider's minimum reserve and initialize the new dedicated NEAR contract atomically with deployment. No existing account's code is overwritten.

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
- All 54 gateway/wallet regression tests pass. The suite includes signed-work-order tampering, duplicate credits, lost responses, wrong-chain/code/publisher configuration, and exact finalized NEAR transaction verification.
- Disposable Chromium popup tests pass for success, lost response/window close and rejection. Wallet pages were intercepted synthetic fixtures; no external wallet or blockchain call was made.
- Meteor web messaging reviewed against `@meteorwallet/sdk` 3.24.1. This adapter loads no SDK scripts. A user's actual funded wallet approval and mainnet lifecycle remain to be verified.

## Remaining live requirements

Funding of the prepared accounts, a user-approved deployment transaction and subsequent payment approvals, configured receipt publisher and a safely recoverable production route for the refund demonstration. These new local Keychain identities still need the supervised browser signing connection; they are not automatically present in Meteor. The existing production API is consumed unchanged. No core source is included in the public integration release.
