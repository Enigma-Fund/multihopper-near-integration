# MultiHopper Swarm for Hire

A local NEAR agent-treasury prototype with an interactive workspace, an optional disposable NEAR chain and synthetic assets. Start the local server as described below.

Each customer has separate agent allocations. The recorded experiment applies per-payment and total spending limits, prevents duplicate invoices, and recovers unused recognized principal after a failed job. It uses synthetic funds and software-held local test keys. Unsolicited token transfers are excluded from recognized principal and can remain stranded.

The workspace supports signed Solana-wallet login to the local demo. It has no live Solana API connection, NEAR Intents integration, cross-chain settlement, confidential execution or actual AI agents. Public histories revealed all 4 of 4 tested sources in the prior deterministic tracing test. This is not evidence of transaction unlinkability. It is not a production-ready custody system.

The Solana production application's API supports transfer creation, preparation, and status lookup; a safe NEAR-to-Solana integration requires a real bridge/custody design and independent review of supported assets, account authorization and reconciliation. This page does not send data to the API. Do not enter credentials.

Base: MultiHopper1/multihopper origin/devnet 9cfb402dcb05362141f8b902d4b322d8c295a3e9. Research evidence: enigma/near-swarm-demo-20261104 at d60c2086d302f96fcb40af343340d88f8da01b26. This directory is based on earlier MultiHopper work. Confirm code and logo ownership and licensing and inspect Git history and artifacts before making any repository public.

Original event: https://nearhackathon.com/#apply . The official deadline was 14 November 2026 at 23:59 UTC. Confirm any late-entry path with organizers.

## Interactive workspace and API

Run `node server.mjs` and open http://127.0.0.1:18988. Connect an injected Solana wallet and sign a login message, or use the demo account. Create a synthetic job, issue an agent payment and fail the job to recover its remaining balance. Run `node --test engine.test.cjs` for the model regression.

The local server binds to loopback. All amounts are positive integer synthetic units. State is in memory and resets on restart.

- POST /api/jobs with `{"jobId":"job1","budget":"100","limit":"25"}`.
- POST /api/payments with `{"jobId":"job1","invoiceId":"inv1","amount":"20"}`.
- POST /api/recover with `{"jobId":"job1"}`.

The local API verifies an origin-bound, expiring Solana wallet message signature before assigning a wallet session. Challenges are single-use and the number of pending challenges and sessions is bounded. Without a wallet it uses the shared synthetic demo identity. The in-memory mode is a simulation and resets on restart. The wallet session uses a local HTTP-only cookie and exists only in the current process. This is not a production authentication service: public deployment needs durable session management, HTTPS cookie configuration, rate limits and a proper security review.

The local NEAR mode uses a disposable, loopback-only NEAR sandbox, the existing policy contract and synthetic ordinary-token grant provider. On macOS after restoring the reviewed dependencies and building the WASM through `python3.12 research/hub/near/run.py`, start it from the repository root:

```sh
sandbox-exec -f research/hub/near/sandbox/local-only.sb env DEMO_NEAR=1 PORT=18990 PATH=/usr/bin:/bin:/opt/homebrew/bin node research/near-swarm-hackathon/server.mjs
```

Open http://127.0.0.1:18990. The local mode supports two mapped synthetic customer identities and automatically mints synthetic units. Jobs and wallet-to-synthetic mappings are process-local. If a creation is interrupted, its ID remains blocked as unknown until the disposable instance is restarted. It is not a durable recovery service. Existing payment and recovery operations use the NEAR research coordinator.

Run `env DEMO_TEST_BASE=http://127.0.0.1:18990 node --test research/near-swarm-hackathon/api.test.mjs` against a fresh local instance. The test creates two disposable wallet key pairs, proves control of each, rejects challenge replay and cross-customer requests, checks duplicate and concurrent requests and recovers synthetic balances.

The optional Solana status reader is exposed through the UI and the local API when both `MH_SOLANA_TEST_API_URL` and `MH_SOLANA_TEST_API_KEY` are configured. Only an `mh_test_` key is accepted. A signed wallet session may see only a matching test transfer it owns; route details and recipients are not returned by the demo gateway. Integration tests use a mock server: no actual MultiHopper API has been called. This read-only lookup does not create, authorize or settle transfers, and does not perform or verify TRM screening.

`solana-execution-client.mjs` implements a devnet-only server-side API client for estimates, transfer creation, preparation, status, confirmation and rescue. It requires test credentials, a wallet owner and a durable single-host operation journal. Before making a write, the journal records the request as uncertain; a lost response or interrupted process blocks a duplicate until the operation is reconciled. A recorded API response is not evidence of on-chain finality. Tests use a mock transport; the client does not sign or broadcast transactions. It is not yet wired to the job workflow, a wallet transaction reviewer, a production-grade distributed journal, an operational reconciliation path, or a verified cross-chain custody model. Test credentials alone do not prove that TRM screening is enabled in a particular environment.

There is no NEAR-to-Solana custody or settlement integration. Do not expose this app to the internet or use it with real funds. A real product requires durable authenticated sessions, an independently secured grant-bound key provider, an integrated Solana execution and screening API, a cross-chain settlement and custody design, crash-safe persistent state and independent audit.

`solana-live-client.mjs` is an isolated, mock-tested production API adapter. It requires a configured HTTPS origin, live API key, authenticated wallet owner and operation journal; it rejects responses belonging to a different source or test mode. It is not wired into the browser or job lifecycle, and it cannot independently verify unsigned transaction contents, TRM enforcement or on-chain settlement. Do not use it for live funds until those gates are implemented and reviewed.

`payment-control.mjs` is a local research coordinator for binding an owner-approved, immutable job plan to an agent, recipient, mint, budget and per-payment limit. It persists customer-scoped plans, reserves budget before requesting a quote, rejects duplicate invoices across the customer's jobs, blocks ambiguous requests, verifies returned quote fields, and freezes a job before recovery. Its SQLite state is single-host and its agent and owner inputs must be authenticated by a future caller. It does not hold funds, verify on-chain grants or finality, execute payments or recover principal; frozen reservations require reconciliation. `job-solana-integration.test.mjs` tests the coordinator and production API adapter together using a mock transport only.

The production API adapter can prepare and confirm rescue for a failed, owner-checked transfer. `wallet-execution.mjs` tests ordered wallet handoff, whole-bundle pre-inspection and lost-response handling using mock wallet, transaction inspector and RPC interfaces. It has no real inspector, wallet binding or RPC adapter and is not exposed by the server. An API rescue response or mock confirmation is not proof that funds were recovered; canonical receipts and balance reconciliation are still required.

When explicitly enabled with `MH_LIVE_ENABLED=1` and all four `MH_LIVE_DB_PATH`, `MH_LIVE_API_URL`, `MH_LIVE_API_ORIGIN` and `MH_LIVE_API_KEY` settings, the loopback server exposes wallet-authenticated `/api/live/jobs`, `/api/live/quote`, and `/api/live/freeze` endpoints. These are manual owner-initiated plans and quotes, not funded NEAR jobs or autonomous agent grants. The live configuration is off by default; no real API calls have been made. Transaction preparation is deliberately not exposed until independent transaction validation and safe recovery are implemented. The adapter cannot prove TRM is enabled; do not treat a quote as a screening result or use this research service with real funds.


