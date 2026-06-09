Local data for near.com e2e — do not commit real secrets.

1. Create `.env.test` at repo root (normally gitignored).

2. WalletConnect (home → login → EVM wallets → WC, then trade / confidential):
   - WALLETCONNECT_PROJECT_ID — Reown project id (local .env.test + GitHub secret for CI).
   - EVM_PRIVATE_KEY — must derive to TEST_EVM_EXPECTED_ADDRESS in `.env.test.defaults`
     (current test wallet: 0xC7f5E984238CDc27c2FDC598B1eFE89870dCFc19).
   - Run `npm run verify:wallet-env` after editing `.env.test`.
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
