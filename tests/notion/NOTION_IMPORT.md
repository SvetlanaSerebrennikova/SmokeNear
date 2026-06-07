# Import test documentation into Notion

Use the English master doc: **`tests/TESTING.en.md`**

## Option A — Markdown import (recommended)

1. Open Notion workspace.
2. Create a new page (e.g. **near-e2e-starter — Test catalog**).
3. Click **⋯** (top right) → **Import**.
4. Choose **Markdown**.
5. Upload or select `TESTING.en.md` from this repository.
6. Notion creates a single page with headings, tables, and callouts (the import tip at the top becomes a quote block).

### Suggested Notion hierarchy after import

Split into child pages if the doc feels long:

| Notion child page | Source sections |
|-------------------|-----------------|
| Overview & run commands | How to run, Architecture, Environment |
| Integration tests | intents.near + 1Click API |
| E2E — Guest | validation/* |
| E2E — Wallet setup | Wallet chain shared setup |
| E2E — Trade | trade/01 … 05 |
| E2E — Transfer | transfer/05, 06 |
| Reference | Strict modes, File map, Out of scope |

To split: highlight a `##` section → **Turn into** → **Page** (Notion moves content to a subpage).

## Option B — Copy & paste

1. Open `TESTING.en.md` in VS Code / Cursor.
2. Open preview or raw markdown.
3. Select all → Copy.
4. Paste into an empty Notion page.

Tables and `##` headings usually convert correctly. Code blocks may need formatting via `/code`.

## Option C — Notion database (test catalog)

If you want one row per test:

1. Create a **Database — Table**.
2. Columns: `Layer` (Integration / E2E Guest / E2E Wallet), `File`, `Test name`, `Timeout`, `Steps summary`, `Assertions summary`.
3. Copy rows manually from `TESTING.en.md`, or import CSV you build from the markdown tables.

There is no auto-generated CSV in the repo; use Option A/B for full step-by-step detail.

## Mermaid diagram

Notion does not always import Mermaid from Markdown. After import:

1. Type `/code` → language **Mermaid**.
2. Paste the diagram from **Architecture** in `TESTING.en.md`.

Or rely on the bullet list under **Wallet chain order** in the same section.

## Syncing updates

When tests change in git:

1. Re-export: copy updated `TESTING.en.md` into Notion (replace page content), or re-import as a new page and archive the old one.
2. Link the Notion page to the repo path `tests/TESTING.en.md` in a callout at the top.

Documentation is English only: `tests/TESTING.en.md`.
