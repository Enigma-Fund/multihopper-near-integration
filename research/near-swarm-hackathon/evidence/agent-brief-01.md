# Agent deliverable: NEAR agent-payment brief

Prepared November 17, 2026 for demo invoice `agent-brief-01`.
This is a research deliverable, not evidence that an invoice has been paid.

NEAR positions Intents as infrastructure for expressing a desired transaction outcome and having competing solvers execute it. This can simplify an agent's cross-chain payment task without making the agent implement every underlying execution path. [NEAR Intents](https://www.near.org/intents)

NEAR's Chain Abstraction stack combines cross-chain signing, Intents and bridging capabilities. Its Chain Signatures architecture uses distributed signing rather than placing the whole signing key in an application. Those capabilities are potential integration options; the current Swarm demo does not use Chain Signatures to authorize its Solana payments. [NEAR Chain Abstraction](https://www.near.org/chain-abstraction)

NEAR's roadmap connects cross-chain financial infrastructure with autonomous AI agents. Our proposed contribution is a customer-approved work order, explicit spending limits, duplicate-invoice protection and a verifiable association between a NEAR job and its Solana settlement evidence. This is our product interpretation of the roadmap, not an endorsement or a claim of completed live settlement. [NEAR roadmap](https://roadmap.near.org/)

The demonstration's acceptance gate is concrete: the authorized recipient must receive the quoted amount; the payout and screening evidence must be independently verified; and the corresponding invoice must be recorded once on NEAR. A failed job requires actual recoverable funds and a verified refund, not merely a closed work order.
