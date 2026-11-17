# Swarm for Hire: two-chain live demonstration

Updated November 17, 2026. **NEAR mainnet deployment finalized; live payout, recovery and finished recording remain pending.**

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
- All 64 gateway, wallet and local signing regression tests pass. The suite includes signed-work-order tampering, duplicate credits, lost responses, wrong-chain/code/publisher configuration, exact finalized NEAR transaction verification, canonical message compatibility, concurrent approval exclusion, persistence before broadcast, and the full link-signing sequence when the browser refuses additional popups. The popup regression uses synthetic responses; it is not proof of a completed mainnet payment.
- Disposable Chromium popup tests pass for success, lost response/window close and rejection. Wallet pages were intercepted synthetic fixtures; no external wallet or blockchain call was made.
- Meteor web messaging reviewed against `@meteorwallet/sdk` 3.24.1. This adapter loads no SDK scripts. A user's actual funded wallet approval and mainnet lifecycle remain to be verified.

## Remaining live requirements

Complete the account-approved NEAR job link, invoice reservation and Solana wallet payment; verify the resulting payout and screening proof; publish and independently verify the NEAR receipt. A live refund additionally needs an actual recoverable route with positive funds, not a fabricated repayment. Then finish the website recording and attach both-chain receipts. These local Keychain identities use the supervised demo connector; they are not imported into Meteor. The existing production API is consumed unchanged. No core source is included in the public integration release.
