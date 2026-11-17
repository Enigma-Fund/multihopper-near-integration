# Dedicated demo approval connection

The public website normally uses Solana Wallet Standard and Meteor. `?localDemo=1` selects this opt-in connection for the owner's pre-funded demonstration accounts. It is not a hosted signing service or a way for judges to access those accounts.

`approve-demo.swift` requires a native macOS confirmation before reading an account key and signing. It returns only the signature. `demo-wallet.mjs` binds only to `127.0.0.1:18871`, pins the local Host/Origin and permitted website origins, decodes the NEAR actions, checks network/code/publisher/nonce, and enforces the Solana account/program/budget limits. Unknown methods, account-key changes and deletion are rejected. The receipt publisher is configured separately as a server secret and cannot sign as a funded account.

Compile the native helper using only Apple's system libraries:

```sh
swiftc -module-cache-path /private/tmp/swarm-swift-modules -parse-as-library research/near-swarm-hackathon/ops/approve-demo.swift -o research/near-swarm-hackathon/ops/build/approve-demo
```

The operator's ignored `wallet.local.json` contains public configuration only: `solana`, `contract` and `operator` (`accountId`, `publicKey`), `publisher` (receipt public key, base64) and `wasmSha256`. Account keys must already be stored under the dedicated Keychain identities expected by the reviewed helper. Do not put private keys into this configuration. The public repository does not include account configuration, signed-transaction journals or compiled helper binaries.

An optional ignored `build/rpc-config.local.json` containing `{"url":"https://…"}` selects the operator's authenticated Solana connection for local preflight checks. Only the explicitly permitted HTTPS provider hosts are accepted; the requesting website cannot set this value. Keep any RPC credential out of commits, screenshots and browser responses. The hosted workspace independently uses its `SWARM_ARCHIVE_RPC` server secret. Both readers verify the mainnet genesis hash; a configured endpoint does not override network checks.

Start `node research/near-swarm-hackathon/ops/demo-wallet.mjs` on that Mac. The local page prepares an unsigned deployment, or reports an already deployed matching contract. Starting the server, connecting an account, preparing a transaction and checking status cannot sign or broadcast. Only the human-operated approval endpoint invokes the native confirmation. The user must perform account-signing and transaction approvals.

The approval journal is stored locally before NEAR broadcast. A lost response or restart resolves the original hash, with no second signing or automatic replacement. Concurrent approval requests are excluded. Solana signatures are returned to the website, whose independently validated invoice batch persists them before broadcasting. A rejected native confirmation is retryable; ambiguous submission remains a reconciliation operation.

Run `node --test research/near-swarm-hackathon/ops/*.test.mjs research/near-swarm-hackathon/site/local-demo-wallet.test.mjs` for the synthetic signing tests. They do not access Keychain, sign with funded keys or contact a live blockchain. The exact mainnet deployment receipt is separately saved in `../evidence/`.

This local demonstration connector is deliberately narrower than a general-purpose wallet and has not had an independent security audit. The publicly hosted receipt publisher is also an explicit trust dependency, not a cross-chain light client.

The demo Solana connector now accepts up to 12 transactions in one explicit native approval. It verifies all API co-signatures and preserves them. The whole signed batch is journaled before it is returned to the website. Startup, preparation and status checks still cannot sign or broadcast. Only the user’s native confirmation releases signatures.
