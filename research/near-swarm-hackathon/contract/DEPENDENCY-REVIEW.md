# Dependency and wallet protocol review — 2026-11-17

No third-party skill or new executable dependency was installed for this integration. The NEAR contract was built offline from the already reviewed sandbox toolchain and cargo cache. Every registry package in its Cargo.lock matched the exact name, version and checksum in the existing reviewed NEAR harness lock. Local builds were restricted to local filesystem and loopback networking.

The browser uses our own small Meteor postMessage adapter. We read `@meteorwallet/sdk` 3.24.1 as text after checking its tarball against the npm registry SHA-512 integrity. We did not install, import or execute that SDK or its dependencies. The reviewed protocol sections were `ported_common/dapp/dapp.enums.ts`, `postMessage/MeteorPostMessenger.ts`, and the v1 `signMessage` / `requestSignTransactions` methods. This is a limited protocol review, not an audit of the full SDK. Our adapter checks both wallet origin and popup source as well as the unpredictable connection ID, does not load remote scripts, and does not handle private keys.

Pinned references:

- SDK tarball integrity: `sha512-Y2OUfhqKBXW7PjwT4QxBkqV8ykIF+WSWxSGk8dHyA4F7y67LEphGWXPvwCbNWhVq+OaZ6bRF5KgfMcTg5Uh+0A==`.
- SDK ESM bundle reviewed as text: SHA-256 `1185f9848122da17f69522ebb56683d057e9f217e7c8a3e584941329c5c31780`.
- MyNearWallet retirement source: `mynearwallet/my-near-wallet` commit `2b3906eaa3e467f4e901f61326e62cd9c955f70d`, config `SUNSET_DISABLED_FROM` retires app signing in phase 3. Its public sunset notice confirms the migration. The integration now uses Meteor.

No finding here establishes that a third-party wallet is risk-free. The live wallet remains a user-controlled signing boundary; public RPC results and wallet-returned hashes are independently checked by the gateway.
