# Isolated cancellation escrow experiment

This is new integration research, NOT an upgrade to the deployed Swarm registry or MultiHopper core. Native NEAR synthetic principal resides in a dedicated contract account per job. Never deploy into a shared registry account. This cannot recall assets from Solana.

The account owner initializes a fixed customer and recipient. The customer funds once, then may release or cancel. Each operation locks the principal before issuing a transfer promise. Only its private callback can finalize the outcome; a failed transfer restores funded state. A second fund, overlapping release/cancel, unauthorized cancellation and terminal replay reject. Principal remains fixed: unsolicited deposits and deployment/storage funding are not added to the payout/refund. Storage must be supplied separately before principal funding.

A browser disconnect does not cancel the on-chain promise chain. There is deliberately no timeout-based unlock: if callback execution ever fails, do not resubmit an uncertain transfer. An independent review and a proven resolution mechanism for that failure are required before real funds. This is NOT production-ready cancellation for SOL.

Validated in a real loopback NEAR sandbox with synthetic accounts: 11 checks, including duplicate funding rejection, unauthorized cancellation, restart after funding, refund then payout rejection, independent second chamber, payout then refund rejection, failed recipient transfer, restart and refund retry. No live network transactions.

Build with the pinned near-sdk 5.29.1 and lockfile; reuse the reviewed toolchain/cache described in ../contract/DEPENDENCY-REVIEW.md. Run local-test.mjs with the existing sandbox harness. No new dependencies were downloaded for this experiment.
