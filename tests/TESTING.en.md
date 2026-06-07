# near-e2e-starter — Test guide (English)

Plain-language description of every automated test: what happens step by step, what is verified, why it matters, and what success looks like. No code samples — only tables and short explanations.

**Application under test:** near.com (live site by default).

**Scope:** 7 integration checks (no browser) + 15 browser end-to-end checks = **22 tests total**.

**Notion:** import this Markdown file, or copy-paste into a Notion page. Tables and headings convert cleanly.

---

## How the suite is organized

| Layer | Tool | Browser? | What it validates |
|-------|------|----------|-------------------|
| Integration | Vitest | No | NEAR contract views and 1Click HTTP API contracts |
| E2E — Guest | Playwright | Yes (anonymous) | Marketing home, login rails, guest redirects |
| E2E — Wallet | Playwright | Yes (WalletConnect) | Signed-in trade, swap, confidential transfer |

**Wallet tests run in one chain** on a single browser tab and one WalletConnect session, in file order: trade steps 01 → 05, then confidential deposit, then confidential withdraw.

**Guest tests** each open a fresh anonymous session. When you run the full E2E suite, guest tests run after the wallet chain (Playwright sorts folders by path).

**Before wallet test 01**, the suite automatically signs in via WalletConnect (home → login → EVM wallets → WalletConnect pairing). Later wallet tests reuse that session.

---

## What you need to run tests

| Need | Why |
|------|-----|
| Local secrets file | Wallet tests require WalletConnect project id and an EVM private key |
| Default account for intents | NEAR account id for on-chain balance reads defaults to relay.tg if not set |
| Network access | Tests hit near.com, NEAR mainnet RPC, Ethereum RPC, and 1Click API |

| Optional setting | Effect |
|------------------|--------|
| Strict 1Click status after swap | Waits until swap status API reports SUCCESS (slow) |
| Strict browser 1Click traffic | Fails if near.com does not call 1Click from the browser |
| Visible browser mode | Shows Chrome window for debugging |

---

# Integration tests (7)

These run in Node without opening a browser. They confirm backends and contracts respond correctly.

---

## intents.near — on-chain balance views (2 tests)

**File:** integration/intents.test.ts  
**Network:** NEAR mainnet  
**Contract:** intents.near  
**Account used:** from environment, default relay.tg

### Test A — Single token balance read

**Purpose:** Prove we can read one multi-token balance from intents.near and the response is well-formed.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Pick the first configured token (default: wrapped NEAR) | Token definition exists | Ensures configuration is not empty | At least one instrument is defined |
| 2 | Call on-chain view for one account and one token | Response is a non-negative whole number as text | Matches how the contract stores balances | Digit-only balance string, value ≥ 0 |
| 3 | Convert raw units to human amount | Result is a normal number | Confirms decimals are applied correctly | Finite human-readable balance |

---

### Test B — Batch balance read

**Purpose:** Prove batch balance query returns one result per requested token, aligned in order.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Take up to five configured tokens | List is not empty | Batch call needs multiple ids | Several token ids prepared |
| 2 | Request all balances in one on-chain call | Output is an array | Batch API must stay in sync with input length | Array length equals number of tokens |
| 3 | Inspect each balance | Each entry is valid non-negative digits | Corrupt or missing entries would break swap funding logic | Every balance is a valid ≥ 0 integer string |

---

## 1Click API — chaindefuser (5 tests)

**File:** integration/oneclick-api.spec.ts  
**Service:** 1Click HTTP API (swap quoting and status)

### Test C — Token catalog

**Purpose:** Ensure the public token list is rich enough for swaps and has required fields.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Request full token list | More than ten assets returned | Empty or tiny catalog blocks swaps | Large catalog |
| 2 | Sample first twenty entries | Each has asset id, decimals, symbol, chain, price | Clients rely on these fields for UI and math | All fields present and sane |
| 3 | Scan entire catalog | At least one token has a positive price | Priced assets needed for realistic quotes | Some priced tokens exist |
| 4 | Look up USDC on NEAR | Asset exists | Default test swap pair uses USDC on NEAR | USDC-on-NEAR entry found |

---

### Test D — Dry quote (preview only)

**Purpose:** Verify quote preview works without creating a deposit address.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Build default pair USDC → wrapped NEAR on NEAR | Pair resolves | Standard near.com-style route | Pair found |
| 2 | Request quote in dry mode | Input and output amounts are integer strings | Amounts are base units, not floats | Valid amount strings |
| 3 | Compare min output to quoted output | Min output ≤ quoted output | Protects user from excessive slippage | Slippage rule holds |
| 4 | Inspect deposit fields | No deposit address, no deadline | Dry run must not allocate deposit infrastructure | Deposit fields absent |
| 5 | Check time estimate | Estimate is positive | UX shows expected duration | timeEstimate > 0 |

---

### Test E — Live quote and pending status

**Purpose:** Verify a real quote creates a deposit target and status endpoint sees it as pending.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Request non-dry quote for default pair | Deposit address and deadline returned | Real swaps need somewhere to send funds | Deposit address and deadline present |
| 2 | Check correlation metadata | Correlation id or timestamp exists | Traceability for support and polling | Tracking field present |
| 3 | Query status for deposit address | Status is an early lifecycle state | Confirms status API is wired to new quotes | PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, or PROCESSING |
| 4 | Check status payload | Updated timestamp exists | Stale status would confuse automation | updatedAt populated |

---

### Test F — Invalid asset rejected

**Purpose:** API must reject nonsense asset ids with a clear client error.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Send quote with fake origin asset id | Server responds with client error | Prevents silent bad swaps | HTTP 400 class error |

---

### Test G — Deposit notification accepted

**Purpose:** Deposit submit endpoint accepts a notify payload (even with a dummy transaction hash in test).

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Create real quote with deposit address | Address exists | Submit needs a valid target | Deposit address obtained |
| 2 | POST deposit notification with placeholder hash | API returns structured response | Confirms webhook/notify path works | Response includes correlation id |
| 3 | Read returned status | Status is a known processing state | Swap pipeline should acknowledge notify | KNOWN_DEPOSIT_TX, PENDING_DEPOSIT, or PROCESSING |

---

# E2E — Guest tests (8)

Anonymous user. No wallet connected.

---

## Homepage (2 tests)

**File:** validation/homepage.spec.ts

### Test H — Page loads without JavaScript crashes

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Listen for uncaught page errors | Error list stays empty | Silent JS failures break login and swap later | Zero page errors |
| 2 | Open home page | Document title matches marketing branding | Basic SEO/branding sanity | Title matches DeFi hub / NEAR pattern |
| 3 | Wait for initial load | Page reaches stable loaded state | Avoid asserting on half-rendered shell | Load completes |

---

### Test I — Sign-in entry visible

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open home page | Sign in control visible | Guests must find auth entry | Sign in link or button shown |

---

## Login and Web3 picker (4 tests)

**File:** validation/login-and-web3-picker.spec.ts

### Test J — Sign in navigates to login

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open home | Starting point is marketing home | Real user flow | Home loads |
| 2 | Click Sign in | URL becomes login route | Routing must expose auth | Address contains login |

---

### Test K — Login shows auth options

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open login page directly | Passkey option visible | Modern auth rail present | Passkey shown |
| 2 | Count Web3 provider buttons | At least four Web3 rows | near.com lists many chains/wallets | ≥ 4 Web3 buttons |
| 3 | Look for NEAR and EVM entry points | Both visible | Core NEAR product paths | Web3 NEAR and EVM wallets visible |

---

### Test L — EVM rail exposes WalletConnect

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open login | Login shell ready | | Login page open |
| 2 | Open EVM wallets rail (or browser wallet fallback) | Secondary provider list opens | WalletConnect is nested under EVM | Rail expands |
| 3 | Find WalletConnect | Option visible | Primary automation path for EVM | WalletConnect shown |
| 4 | For each known provider label in config | If button exists, it is visible | Regression when copy changes but buttons remain | Known providers visible when present |

---

### Test M — Single click on EVM rail still reaches WalletConnect

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open login | | | Login page |
| 2 | Click EVM wallets once | WalletConnect appears without extra navigation | Reduces flaky extra clicks in tests | WalletConnect visible |

---

## Guest swap and trade routes (2 tests)

**File:** validation/swap-guest-redirect.spec.ts

### Test N — Guest swap redirects to login with return path

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Collect uncaught errors | No JS crashes | | Zero errors |
| 2 | Open swap as guest | Within timeout, lands on login | Protected swap must not render for guests | URL is login |
| 3 | Read redirect query parameter | Parameter present and decodes to swap path | After login user should return to swap | redirect points to swap |
| 4 | Find Sign in heading on login page | Heading visible | Avoid blank login shell | Sign in heading shown |

---

### Test O — Guest trade route shows not found

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open trade URL as guest | Not-found message shown | Old or wrong route should not expose broken UI | “Page does not exist” heading |
| 2 | Look for home link | Recovery link visible | User can leave error state | Back to home link visible |

---

# E2E — Wallet chain setup (runs once before trade/01)

**Purpose:** Establish a real WalletConnect session so all wallet tests share one signed-in user.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Start WalletConnect bridge in Node with configured EVM key | Bridge ready to sign | Tests must approve transactions without manual MetaMask | Bridge initialized |
| 2 | Open home, click Sign in, reach login | On login page | Matches human sign-in path | Login URL |
| 3 | Open EVM wallets provider list | List visible | WalletConnect lives under EVM rail | Providers shown |
| 4 | Choose WalletConnect; confirm modal if needed | Pairing URI appears | Session pairing | URI readable |
| 5 | Pair from test bridge | near.com receives session | Headless signing | Pairing succeeds |
| 6 | Dismiss verify-wallet modal if shown | Modal not blocking | Optional friction | Modal cleared |
| 7 | Read header account indicator | Shows same EVM address as bridge | Proves connection succeeded | Truncated address matches test wallet |

---

# E2E — Trade (5 tests)

Signed-in user on near.com swap/trade flows.

---

## Trade 01 — Connected address in header

**File:** trade/01-connected-evm-address.spec.ts  
**Timeout:** about 2 minutes

**Purpose:** After shared login, the UI must show the connected EVM address.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Look at header account chip | Chip visible | Users must see they are connected | Indicator visible within timeout |
| 2 | Compare chip text to bridge address | Text matches connection | Wrong address means wrong wallet signed | Displayed address matches test EVM account |

---

## Trade 02 — Intents balances and swap card lines

**File:** trade/02-intents-and-swap-card-lines.spec.ts  
**Timeout:** about 4 minutes

**Purpose:** On-chain intents balances are readable; swap UI shows amount-and-token lines; optional ETH balance cross-check.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Load configured token instruments | List not empty | Nothing to assert without instruments | ≥ 1 instrument |
| 2 | Batch-read balances for configured account | One balance per token, all valid non-negative | Funding logic merges chain + UI | Aligned valid balances |
| 3 | Smoke-fetch human balances | Call completes | Ensures helper path works | No throw |
| 4 | Open swap while signed in | Not sent to login | Swap is authenticated | Stays on swap |
| 5 | Wait for main content | Text includes number + token symbol pattern | Swap card must show tradable lines | Amount + symbol visible |
| 6 | Read ETH balance from public Ethereum RPC for connected address | Finite balance | Independent sanity on EVM side | Valid ETH number |
| 7 | If UI shows ETH balance candidates | One UI value close to RPC value | Catches wildly wrong display | Match within tolerance, or skip if UI omits ETH |

**Note:** Does not require positive intents balance — only valid RPC responses.

---

## Trade 03 — Swap funding prerequisites

**File:** trade/03-swap-funding-prerequisites.spec.ts  
**Timeout:** about 3 minutes

**Purpose:** Signed-in swap page shows fundable pay tokens from real balances, not empty defaults.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open swap | URL is swap, not login | | Authenticated swap |
| 2 | Find trade/swap heading | Heading visible | Confirms correct page | Heading shown |
| 3 | Find amount input | Placeholder visible | User can enter trade size | Enter amount field visible |
| 4 | Merge on-chain intents balances with scraped UI balances | Combined max balance > 0 | Must have something to trade | Positive funding signal |
| 5 | Rank pay-side candidates | At least one candidate | Automation needs a pay token | ≥ 1 candidate |
| 6 | Inspect top candidate | Balance ≥ minimum pay for that token | Avoid choosing symbol with dust only | Top candidate fundable |
| 7 | Try selecting top token in UI | Best-effort selection | Prepares later swap tests | Selection attempted |

---

## Trade 04 — Full swap through completion card

**File:** trade/04-swap-complete-and-card.spec.ts  
**Timeout:** up to 20 minutes

**Purpose:** Execute a real swap: quote, sign, explorer link, Trade complete card with correct pay/receive summary. Optional deep 1Click status poll only when enabled in environment.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open swap authenticated | Swap UI ready | | Swap page loaded |
| 2 | Pick pay token with balance; fill amount; wait for quote (retry reloads up to 5 times) | Executable quote: submit enabled, no quote error banner | Swaps fail if solver quote missing | Pay side + ready quote |
| 3 | Confirm quote still ready | Primary action enabled | | Submit ready |
| 4 | Click submit; click confirm/sign buttons if shown | Signing in WC or UI completion or explorer CTA | Real swap needs signature | Progress signal within timeout |
| 5 | Wait until signing, Trade complete, or explorer control | One success signal | | Condition met |
| 6 | View explorer control visible | Link/button to near-intents explorer | User-facing completion path | Explorer CTA shown |
| 7 | Open explorer (new tab or same tab) | near-intents host loads; extra tabs closed afterward | Validates explorer integration | Explorer opens; cleanup done |
| 8 | Return focus to swap tab | Trade complete banner returns | Tab switch can hide banner briefly | Trade complete visible again |
| 9 | Read completion card text | Pay amount matches submitted amount (~6% tolerance); at least two token legs (pay vs receive) | Prevents wrong summary after swap | Pay leg accurate; distinct receive leg |
| 10 | If stuck on explorer host, navigate back to swap | Clean state for following tests | | Swap URL restored |
| 11 | **Optional — only if strict status poll enabled** | | | |
| 11a | Resolve deposit address from explorer, page, or session | Address found | Status API needs target | Deposit address known |
| 11b | Notify deposit with tx hash if captured | Notify accepted (best effort) | Speeds status transition | Notify sent or ignored safely |
| 11c | Poll status until terminal | Status SUCCESS; positive formatted output if present | End-to-end swap settlement | SUCCESS |

**Default:** step 11 is **skipped** — test ends after Trade complete card checks.

---

## Trade 05 — 1Click network or API fallback

**File:** trade/05-swap-oneclick-network.spec.ts  
**Timeout:** about 4 minutes

**Purpose:** Confirm 1Click integration: either browser calls tokens+quote during swap, or direct API contract check when near.com quotes server-side.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Attach network listener for 1Click-shaped requests | Listener active | Detect browser-side API | Recorder running |
| 2 | Confirm still signed in on home | EVM indicator | Session alive | Signed in |
| 3 | Run swap funding prerequisites | Same as trade 03 | Funded swap surface | Prerequisites pass |
| 4 | Ensure pay side with executable quote | Pay + quote ready | Triggers quote traffic | Executable quote |
| 5 | Short wait for network activity | | | |
| 6a | **If** browser called tokens and quote endpoints | At least one HTTP success | near.com proxied 1Click in browser | 2xx responses recorded |
| 6b | **Else** call 1Click API directly (dry quote) | Tokens list and dry quote succeed | near.com often quotes on server; still validates contract | API fallback passes; noted in report |
| 6c | **If strict browser mode enabled** and no browser traffic | Test fails | Forces browser proxy regression | Failure |

---

# E2E — Confidential transfer (2 tests)

Signed-in user. Shield = main → confidential. Unshield = confidential → main.

---

## Transfer 05 — Confidential deposit (shield)

**File:** transfer/05-confidential-deposit.spec.ts  
**URL:** confidential transfer with shield mode  
**Amount:** 1 unit  
**Timeout:** up to 12 minutes

**Purpose:** Move a small amount from main balance into confidential account; confirm success UI.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Open home; verify EVM indicator | Signed in, not login | Same baseline as trade | Authenticated |
| 3 | Open shield URL | Confidential transfer with shield mode in URL | Correct product mode | shield mode in address |
| 4 | Read intro copy | Text explains main → confidential | User understands direction | Intro copy visible |
| 5 | Click send-this-token CTA | Button visible and clicked | Starts flow | CTA works |
| 6 | Token picker opens | Select token dialog | | Dialog with Select token |
| 7 | Pick first recognizable token under Your tokens | Ticker inferred from row | Uses same picker pattern as swap | Token chosen |
| 8 | Enter amount 1 | Amount field accepts input | Small safe amount | Amount filled |
| 9 | Click Confirm | Button enabled; WC signs | On-chain / auth action | Confirm clicked |
| 10 | Wait for success wording | Complete / success / deposited etc. | Operation finished | Success message visible |
| 11 | Click Move again (or shield fallback link) | Stay on confidential shield context | User can repeat flow | Still on shield URL |
| 12 | Close overlays; verify URL | Still shield mode | Shell stable after success | shield mode retained |

**Balance before/after assertions:** disabled temporarily (UI scrape was flaky).

---

## Transfer 06 — Confidential withdraw (unshield)

**File:** transfer/06-confidential-withdraw.spec.ts  
**URL:** confidential transfer with unshield mode  
**Amount:** 1 unit  
**Timeout:** up to 12 minutes  
**Standalone:** does not require deposit test to pass first.

**Purpose:** Move a small amount from confidential back to main; confirm success UI.

| Step | What we do | What we check | Why | Expected result |
|------|------------|---------------|-----|-----------------|
| 1 | Preconditions on home | Signed in | | Authenticated |
| 2 | Open unshield URL | unshield mode in URL | Correct mode | unshield mode in address |
| 3 | Click To Main segment | Segment visible and active | Direction confidential → main | To Main selected |
| 4 | Read intro copy | Text explains confidential → main | | Intro copy visible |
| 5 | Click send-this-token | | | CTA works |
| 6 | Token picker | Select token dialog | | Dialog open |
| 7 | Pick token from Your tokens | Ticker recognized | | Token chosen |
| 8 | Balance snapshot | **Disabled** | Was flaky | — |
| 9 | Enter amount 1 | | Small test amount | Filled |
| 10 | Confirm via WC | | | Signed |
| 11 | Wait for success | Complete / withdrawn / similar | | Success visible |
| 12 | Move again or unshield link fallback | URL stays unshield | | unshield mode retained |
| 13 | Post-withdraw shell | URL still confidential unshield | | Stable shell |

**Balance assertions:** disabled temporarily.

---

# Quick reference — all 22 tests

| # | Area | Test name (short) | Pass means |
|---|------|-------------------|------------|
| A | Integration | Single intents balance | Valid on-chain balance string |
| B | Integration | Batch intents balances | Array aligned and valid |
| C | Integration | 1Click token catalog | Rich catalog incl. USDC NEAR |
| D | Integration | 1Click dry quote | Preview amounts, no deposit |
| E | Integration | 1Click live quote + status | Deposit + pending status |
| F | Integration | 1Click bad asset | 400 error |
| G | Integration | 1Click deposit notify | Notify accepted |
| H | E2E guest | Home no JS errors | Clean load + title |
| I | E2E guest | Sign in visible | Entry point shown |
| J | E2E guest | Home → login | Routing works |
| K | E2E guest | Login rails | Passkey + Web3 options |
| L | E2E guest | WalletConnect on login | WC reachable |
| M | E2E guest | EVM one-click to WC | WC without extra steps |
| N | E2E guest | Guest swap → login | Redirect + return path |
| O | E2E guest | Guest trade 404 | Not found page |
| — | E2E wallet | WC setup (fixture) | Signed in once |
| 01 | E2E trade | Header address | Correct EVM shown |
| 02 | E2E trade | Intents + swap lines | RPC OK + UI lines |
| 03 | E2E trade | Funding prerequisites | Fundable pay token |
| 04 | E2E trade | Full swap complete | Trade complete card OK |
| 05 | E2E trade | 1Click browser/API | Integration path OK |
| 05 | E2E transfer | Shield deposit | Success UI shield |
| 06 | E2E transfer | Unshield withdraw | Success UI unshield |

---

# Out of scope

| Topic | Status |
|-------|--------|
| Unit test folder | Empty — nothing to run |
| NEAR local sandbox from README template | Not wired in this repo |
| Confidential balance math in UI | Assertions commented out until scrape stable |
| Deep block explorer page content | Commented out in full swap test |
| Russian duplicate of this doc | Removed — English only |

---

*Update this guide when test behavior changes.*
