# Live activation evidence — 18 November 2026

Isolated Swarm Pages deployment: `0bb81077-473c-459b-84bd-a27913a60b19`, successful. Live API reports version 4 and receiptVersion 2. Official business site links to this application.

The verification-only `swarm-settlement-reconciler` Worker is scheduled every minute. Its first observed automatic successful heartbeat was 11:56:43 UTC (12:56:43 Europe/Paris), after the single manual check at 11:47:13 UTC. No additional manual trigger was used. The scheduled run checked zero unfinished invoices because the existing invoice was already final.

Before/after: agent-brief-01 remains transfer 264, payout-confirmed, credited 2,487,562 lamports. One completed wallet batch and one final signature remain. Final NEAR state independently read as paid for the same amount and evidence hash. No new payment, funding, signing or chain transaction was initiated during activation.

98 local tests pass with no failures or skips, including interrupted recovery, duplicate funding, concurrent leases, stale-worker fencing, endpoint authorization and the scheduler's fixed verification-only target. No unfinished live job existed, so a real interrupted-job resume was not demonstrated by this activation.

Unified receipts remain opt-in and require the owner's sharing signature. No public link was created without that consent. Existing links retain their original consented payload. Cancellation remains an isolated native-NEAR prototype; it is not deployed and cannot cancel a healthy Solana production route. Core production files and programs remain untouched.
