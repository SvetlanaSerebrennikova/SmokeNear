# NEAR E2E Testing Starter

A complete, production-ready E2E testing scaffold for NEAR Protocol dApps.
Covers all three layers of the testing pyramid: unit → integration → E2E.

---

## Project Structure

```
near-e2e-starter/
├── contracts/
│   ├── Cargo.toml
│   └── src/lib.rs              # Example Rust contract (replace with yours)
├── tests/
│   ├── unit/
│   │   ├── utils.test.ts       # Frontend utility tests (Vitest)
│   │   └── transaction-builder.test.ts
│   ├── integration/
│   │   └── contract.test.ts    # near-workspaces sandbox tests
│   └── e2e/
│       ├── helpers/
│       │   └── wallet-mock.ts  # Wallet injection utilities
│       ├── global-setup.ts     # Pre-auth browser state
│       ├── wallet-flows.local.spec.ts   # Mocked wallet tests
│       └── contract-flows.testnet.spec.ts  # Real testnet tests
├── scripts/
│   ├── setup-test-accounts.js  # One-time testnet account setup
│   └── load-test.js            # k6 RPC load test
├── .github/workflows/
│   └── ci.yml                  # Smoke CI (push main + daily 17:00 MSK)
├── .env.test.example           # Environment variable template
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
npx playwright install --with-deps chromium
```

### 2. Configure environment

```bash
cp .env.test.example .env.test
# Fill in your values (see comments inside)
```

### 3. Build your contract

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
mkdir -p res
cp target/wasm32-unknown-unknown/release/*.wasm res/contract.wasm
cd ..
```

### 4. Run the full suite

```bash
npm test
```

Or run individual layers:

```bash
npm run test:unit           # Vitest — fast, no NEAR needed
npm run test:integration    # near-workspaces sandbox
npm run test:e2e            # Playwright (local + testnet)
```

**Test documentation (English, Notion-friendly):** [tests/TESTING.en.md](tests/TESTING.en.md) · [Import into Notion](tests/notion/NOTION_IMPORT.md)

---

## Test Layers Explained

### Layer 1 — Unit Tests (`tests/unit/`)

Tests pure TypeScript functions in isolation. No NEAR or browser involved.

- **Tool**: Vitest
- **Speed**: ~1–2 seconds
- **When**: On every save in development

```bash
npm run test:unit -- --watch
```

### Layer 2 — Integration Tests (`tests/integration/`)

Deploys your compiled `.wasm` to a local NEAR sandbox and exercises contract
methods directly via `near-workspaces`. No browser, no real network.

- **Tool**: near-workspaces + Jest
- **Speed**: 10–30 seconds
- **When**: Before every PR

> **Tip**: The sandbox starts a real NEAR node locally in Docker.
> Make sure Docker is running before running integration tests.

```bash
npm run test:integration
```

### Layer 3 — E2E Tests (`tests/e2e/`)

Two sub-projects:

| Project | File pattern | Wallet | Network |
|---|---|---|---|
| `localnet` | `*.local.spec.ts` | Mocked (injected JS) | None |
| `testnet` | `*.testnet.spec.ts` | Key from env secret | NEAR testnet |

```bash
npx playwright test --project=localnet    # Fast, no secrets needed
npx playwright test --project=testnet    # Requires .env.test
npx playwright test --ui                 # Visual debug mode
```

---

## Wallet Mocking

The `wallet-mock.ts` helper injects a fake wallet into the browser that:
- Simulates a signed-in account
- Signs transactions without any popup
- Can simulate rejections and latency
- Records all signed transactions for assertion

```typescript
import { injectMockWallet, waitForTransaction } from './helpers/wallet-mock';

test('user can send NEAR', async ({ page }) => {
  await injectMockWallet(page, { accountId: 'alice.testnet' });
  await page.goto('/');
  // ... interact with UI ...
  const tx = await waitForTransaction(page);
  expect(tx).toBeDefined();
});
```

---

## CI/CD Setup

| Workflow | When | What runs |
|---|---|---|
| `ci.yml` (**SmokeNear**) | push **main**, daily **17:00 MSK**, manual | Vitest integration + guest E2E + WC connect (`01`) ~10–20 min |

Full wallet chain (swap, confidential) — run locally: `npm run test:e2e:walletconnect`.

Wallet Playwright jobs read secrets from **GitHub Actions only** — never from a committed `.env.test`.

### Local vs CI

| Where | How secrets are provided |
|---|---|
| **Local** | Copy `.env.test.example` → `.env.test`, fill values (gitignored) |
| **CI** | Repository secrets (see table below) injected as `process.env` |

Non-secret defaults (`APP_URL`, `NEAR_WALLETCONNECT_ACCOUNT`, …) come from `.env.test.defaults` in the repo.

### Secrets to add in GitHub

Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required | Description |
|---|---|---|
| `WALLETCONNECT_PROJECT_ID` | Yes (wallet E2E) | [Reown / WalletConnect Cloud](https://cloud.reown.com) project id |
| `EVM_PRIVATE_KEY` | Yes (wallet E2E) | `0x` + 64 hex — dedicated test wallet with minimal funds |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for daily `ci.yml` notifications |
| `TELEGRAM_CHAT_ID` | No | Chat id for Telegram notifications |

CI fails fast if `WALLETCONNECT_PROJECT_ID` or `EVM_PRIVATE_KEY` is missing.

### Pre-push secret check

```bash
bash scripts/check-no-secrets.sh
```

Never commit `.env.test`. Use `.env.test.example` as the template.

---

## Load Testing

Requires [k6](https://k6.io/docs/get-started/installation/):

```bash
brew install k6   # macOS

CONTRACT_ID=your-contract.testnet k6 run scripts/load-test.js --vus 10 --duration 30s
```

Thresholds (edit in `scripts/load-test.js`):
- p95 HTTP latency < 2000ms
- RPC p90 latency < 1500ms  
- Error rate < 1%

---

## NEAR-Specific Gotchas

| Gotcha | What to test |
|---|---|
| **Storage deposits** | New users must pre-pay; test the error + the happy path |
| **Async receipts** | Don't assert on tx hash — wait for receipt outcome |
| **Gas limits** | Test cross-contract calls with 100+ TGas, not just 30 |
| **Account existence** | Sending to non-existent account fails silently in some UIs |
| **Nonce collisions** | Don't fire concurrent txs from the same account in tests |
| **u128 overflow** | Test arithmetic at `u128::MAX` boundaries in unit tests |

---

## Adapting to Your Project

1. **Replace** the example contract in `contracts/src/lib.rs` with your own
2. **Update** method names in `tests/integration/contract.test.ts`
3. **Update** UI selectors in `tests/e2e/wallet-flows.local.spec.ts`
4. **Add** your app's localStorage key format in `tests/e2e/global-setup.ts`
5. **Adjust** gas amounts in integration tests if you use cross-contract calls

---

## Coverage Targets (Suggested)

| Layer | Target |
|---|---|
| Unit (Rust) | 80%+ line coverage via `cargo-tarpaulin` |
| Unit (TS) | 80%+ line coverage via `c8` |
| Integration | All public contract methods + error paths |
| E2E | All critical user journeys (deposit, withdraw, transfer) |
