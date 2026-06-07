Local data for near.com e2e — do not commit real secrets.

1. Create `.env.test` at repo root (normally gitignored).

2. WalletConnect (`tests/e2e/near-com/user-journey.spec.ts` — home → login → WC, then balances / swap / confidential):
   - WALLETCONNECT_PROJECT_ID — WalletConnect Cloud / Reown dashboard project id.
   - EVM_PRIVATE_KEY — `0x` + 64 hex for the headless approving wallet + optional personal_sign.
   - NEAR_WALLETCONNECT_ACCOUNT — required when proposals include `near:` namespace; also used as
     the default NEAR `account_id` for `intents.near` `mt_balance_of` / `mt_batch_balance_of` in
     trade balance ranking (override with TEST_INTENTS_ACCOUNT_ID).
   - TEST_INTENTS_ACCOUNT_ID — optional explicit NEAR account for intents registry reads (same as
     your near.com / Intents identity, not the `0x` address).
   - TEST_INTENTS_MT_INSTRUMENTS_JSON — optional JSON array:
     `[{"ticker":"usdc","tokenId":"nep141:…","decimals":6},…]` to match your token_ids on mainnet.

   Integration checks (no browser): `npm run test:integration` with TEST_INTENTS_ACCOUNT_ID set.

   Focused smoke:
   npm run test:e2e:walletconnect

   Local runs use a single Chromium worker (tests one after another). HTML report does not
   auto-open (so the command exits when done). View it with:
   npm run test:e2e:report
   Optional auto-open after run: npm run test:e2e:report:auto

3. Optional: unpacked MetaMask for manual Chrome debugging (official zip manifest):
   npm run setup:metamask-extension
   Details: local/metamask-extension/README.txt
