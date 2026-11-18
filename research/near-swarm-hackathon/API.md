# Swarm for Hire API — release 3

Base: https://multihopper-swarm-for-hire.pages.dev/near-swarm

This API belongs to the isolated NEAR integration. It consumes the existing production Solana API; it does not expose or modify MultiHopper core code. The loopback research server and its api.html are a separate synthetic harness.

## Authentication

POST requests are JSON. Sign the exact message returned by `signedMessage(origin, body)` in `site/orders.mjs` with the customer's Solana Ed25519 wallet. Supply owner, UUID id, action, expiry (at most five minutes), signature (hex), and the action-specific fields. Origin, owner, job, invoice, amounts and limits are bound by the canonical message; do not construct a different message format. Server secrets and funded account keys never belong in clients.

## Endpoints

- GET /api: readiness and capabilities. Readiness does not mean a particular invoice is refundable.
- GET /api/health: authenticated API, provider, pinned NEAR contract, history and notifications readiness.
- POST /api/orders: create, read, close. Create binds recipient, budget and per-payment limit. Read returns the owner's job and recent invoice receipts.
- POST /api/settlement: link, invoice, wallet-run, refresh, publish-receipt, cancel-job, close-near. Legacy prepare-wallet/wallet-step remain available for wallets without batch signing.
- POST /api/receipt-share: share-receipt or revoke-receipt, with invoice. Requires the invoice owner's signed consent and a verified terminal receipt.
- GET /receipts/{token}: opt-in receipt HTML, no wallet needed. Random 256-bit capability URL, no indexing, no cache. Contains only outcome, credited amount and Solana transaction links. Anyone with the link can read it. Revocation cannot erase downloaded copies or public chain history. No claim is made that public transaction links conceal the source.
- POST /api/screening: finalized transaction signature and routeId. Verifies accepted MultiHopper screening evidence, not a provider-issued TRM certificate.
- POST /api/notifications: HMAC-authenticated production events. Reconciles only; cannot sign or initiate a payment. Unavailable evidence remains pending.

## Payment and resume

1. Create signed work order; link the NEAR account with its NEP-413 proof and create_job approval.
2. Reserve an invoice with a signed quote request and NEAR reserve_invoice approval.
3. Sign wallet-run with mode payment, invoice and extra cost cap. Operations prepare, stage and step share this authorization. Review all remaining transactions in one supported wallet batch (maximum 12). Persist signatures before broadcasting, then simulate and submit each in sequence.
4. Resume the same invoice after interruption. Reconcile saved signatures; never create another invoice to repair an uncertain response. Expired authorization requires renewal; signed chain transactions remain recorded.
5. Verify finalized payout, exact recipient credit, signed terms and screening evidence. A route cleanup phase such as reclaimed does not invalidate an independently verified payout.
6. Publish the evidence commitment on NEAR with publish-receipt and the separate NEAR record_settlement signature. A Solana authorization cannot sign a NEAR transaction.

## Controlled stop and recovery

cancel-job closes the workspace job before checking invoice recovery. It is idempotent, stops new workspace payment preparation and reports each invoice's eligibility. It does NOT cancel already signed transactions, stop a healthy on-chain route, revoke wallet signatures, or return funds by itself. NEAR close_job is separately signed. Chain execution can race with a workspace stop; reconcile first.

When the production API reports canRescue, use wallet-run with mode recovery and the same invoice. The app batches the remaining recovery transactions, reconciles duplicates and automatically verifies the refund after batch completion without an extra Check settlement signature. Verification matches prepared message hashes, successful finalized transactions, allowed refund instructions and actual owner credit. Credit may include rent; it is not automatically labelled principal-only. Publish the resulting refund receipt on NEAR afterward.

There is no supported on-demand cancellation for a healthy funded production route in this integration. Do not fund a normal payment expecting the stop button to guarantee a refund. A live failed-route refund demonstration remains outstanding; synthetic recovery tests are not live evidence.

## Errors and trust

400: invalid signature, terms, action, budget, evidence or lifecycle. 403: origin mismatch. 404: unavailable/revoked receipt or unknown endpoint. 503: API, history, chain evidence or storage unavailable. Retry the same invoice; do not infer failure or success from a timeout.

NEAR verifies the configured MultiHopper publisher's attestation. It is not a Solana light-client proof or TRM signature. Public receipts expose only the owner's selected settlement; they do not attest to agent work quality.

## Verified release evidence

Live invoice agent-brief-01: 2,487,562 lamports paid, finalized Solana signature 3uGnVe1gabkpugWvGJvSmUKoFLz8CSya1w8RgnLKJbmTTGywwRcrNNcQpHTwgUUbFoUArMm9Wuq5AY45vMKMU84n. NEAR receipt GAyD3kQ8SWaLeEGYbTiFRg4jGvdxWGawgpmY9RvtRxNZ finalized paid. The reviewed source-funding interval contained one funding transfer. Live refund and full-flow recording are not completed.

Apply site/schema.sql and site/settlement.sql to a dedicated D1 database before release. Reproduce site tests with `node --test research/near-swarm-hackathon/site/*.test.mjs`. Do not publish ops/build, private configurations, approval journals, keys, core programs or node_modules.

## Durable reconciliation and unified receipts (isolated next release)

`site/durable.mjs` treats saved invoices as the durable queue. A separate scheduled worker (`site/reconciler-worker.mjs`) polls due unfinished invoices, claims a 60-second lease atomically, verifies existing settlement evidence and schedules a retry after 30 seconds. Leases are fenced: an expired worker cannot overwrite its successor. Due ordering prevents a permanently pending invoice from starving later work. A missed webhook is recovered by polling. No preparation, signing, funding or broadcasting is performed by this worker.

Build the standalone scheduled bundle with `node site/build.mjs /tmp/swarm-reconciler.mjs reconciler` from this integration directory. Configure a one-minute Cloudflare Cron Trigger, the same dedicated SWARM_JOBS database and the existing read/service configuration. Apply the added swarm_reconcile table first. There is no public HTTP trigger. This worker has not yet been activated in the hosted environment; build/test success is not evidence that scheduling is live. Browser-held unsigned or unbroadcast transactions still require the wallet flow; NEAR publication still requires its wallet approval.

Shared receipt version 2 checks the pinned NEAR contract's finalized invoice against the verified Solana amount, outcome and evidence hash. A matching record includes the contract, job/invoice commitments and evidence commitment. Otherwise it explicitly says not-verified. The signed sharing consent includes NEAR commitments. These are a snapshot at issuance, not a continuously monitored status or a TRM-issued signature. Existing share URLs retain their original consented payload; revoke and create a new share to include newly confirmed NEAR evidence.

Real cancellation research lives exclusively in cancellation-contract/. It holds synthetic native NEAR principal in a separate per-job account and arbitrates release versus refund on-chain. It does not alter the Solana production route. Healthy-route SOL cancellation remains unsupported. Callback failure beyond a failed transfer needs further design before live adoption.
