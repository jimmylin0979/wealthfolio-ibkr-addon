# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-09
**Commit:** db1b214
**Branch:** main

## OVERVIEW
Wealthfolio addon "IBKR Multi-Currency Import" (`ibkr-multi-import`): imports Interactive Brokers activity statements (CSV upload or Flex Query API) into Wealthfolio with multi-currency account creation. Pure TypeScript/React 19 — NOT a Rust/Tauri crate. Built by Vite lib-mode to a single ES bundle `dist/addon.js`, loaded by the Wealthfolio host per `manifest.json` + `@wealthfolio/addon-sdk@3.9.0` (migrated from 2.0.0 for host ≥3.6.0 compatibility).

## STRUCTURE
```
ibkr-wealthfolio-addon/
├── manifest.json         # Plugin contract: id, sdkVersion 3.9.0, minWealthfolioVersion 3.6.2, permissions + network.allowedHosts
├── vite.config.ts        # lib build src/addon.tsx → dist/addon.js; react/react-dom external → host globals
├── dev-server.mjs        # Express :3001 serving dist/ for live addon dev; implements the Wealthfolio 3.7+ dev protocol (`/runtime-package`, `/status` generation, `/addon-updates` SSE) — host 404s without it
├── .github/workflows/release.yml  # ONLY CI: tag-triggered; test+build, never type-check
└── src/
    ├── addon.tsx         # ENTRY: enable(ctx: AddonContext) → routes, sidebar, auto-fetch hook; returns {disable}
    ├── pages/            # 2 wizard pages (import flow, Flex settings)
    ├── components/       # 16 React components (wizard steps + generic UI)
    ├── hooks/            # use-flex-configs, use-multi-csv-parser
    ├── lib/              # 23 pure business-logic modules — the pipeline core (see src/lib/AGENTS.md)
    ├── types/            # shared types (sdk-extensions.d.ts removed in 3.9 migration)
    ├── presets/          # raw IBKR CSV row shapes
    └── __tests__/        # 24 vitest suites mirroring lib/
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Addon lifecycle / host wiring | `src/addon.tsx` | `enable(ctx)` is the only host entry; cleanup funcs on disable |
| Import pipeline | `src/lib/import-orchestrator.ts` | preprocess → ticker resolve → convert → FX split → dedup → import |
| Flex Query HTTP | `src/lib/flex-query-fetcher.ts` + `network-http-client.ts` | 2-step SendRequest/GetStatement `v=3` over `ctx.api.network` (brokered HTTPS) |
| IBKR CSV parsing | `src/lib/ibkr-csv-splitter.ts`, `ibkr-preprocessor.ts` | section detection + row classification |
| Money math (dividends/tax/FX) | `src/lib/activity-converter.ts`, `dividend-utils.ts` | highest financial-correctness risk |
| Credential storage | `src/lib/flex-config-storage.ts` | via `ctx.api.secrets` (host keyring) |
| Manifest / permissions | `manifest.json` | host reads this at install/enable |
| Build entry & externals | `vite.config.ts` | only react/react-dom external |

## CODE MAP
(LSP unavailable in this environment; grep-derived. ast-grep unmeasured.)

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `enable` | fn (default export) | `src/addon.tsx:82` | host lifecycle entry; only consumer is the host loading `dist/addon.js` |
| `performAutoFetch` | fn | `src/addon.tsx:202` | debounced+locked auto-fetch on `portfolio.onUpdateComplete` |
| `processFlexQueryConfig` | fn | `src/lib/auto-fetch-processor.ts` | per-config fetch→parse→import; hand-off `activities.import` (:140) |
| `runImport` / orchestrator | fn | `src/lib/import-orchestrator.ts` | shared transform pipeline |
| `importActivities` call sites | API | `auto-fetch-processor.ts:140`, `ibkr-multi-import-page.tsx:572` | writes go ONLY through `ctx.api` |
| `loadConfigsSafe` | fn | `src/lib/flex-config-storage.ts` | safe config loader (prefer over deprecated `loadConfigs`) |

## CONVENTIONS (deviations from standard)
- Entry is `enable(ctx)` per addon-sdk contract — never an npm-style library export; no `src/index.ts`.
- `manifest.json` (not package.json) is the real plugin descriptor; distribution = ZIP via `pnpm bundle`, no npm publish.
- Business logic lives in pure `src/lib/*.ts` (unit-tested); React components stay thin — follow this split.
- `pnpm lint` IS `tsc --noEmit` (no ESLint/formatter exists — don't add one without asking).
- All host access via optional-chained `ctx.api.*` for graceful degradation.
- Flex HTTP goes through `createNetworkHttpClient(ctx.api.network)` (`src/lib/network-http-client.ts`) adapting the SDK 3.9 broker to the fetcher's `HttpClient` interface.

## ANTI-PATTERNS (THIS PROJECT)
- NEVER touch Wealthfolio's SQLite DB, Tauri `invoke`, or filesystem directly — zero such code exists; everything goes through `ctx.api`.
- NEVER bundle react/react-dom — they are host-provided globals (`window.React`/`ReactDOM`).
- NEVER store secrets outside `ctx.api.secrets`; NEVER log tokens or full request URLs (URLs contain `?t=TOKEN`).
- NEVER use deprecated `loadConfigs` in write paths — returns `[]` on error and `addConfig` would wipe existing configs.
- Don't assume `pnpm type-check` passes — it currently fails (73 errors, test files only) and CI never runs it.

## UNIQUE STYLES
- Undocumented host couplings (guarded): `ctx.api.network` (Flex path via network-http-client adapter), `window.__wealthfolio_toast__` (`auto-fetch-processor.ts:42`, cosmetic).
- `AsyncLock` + per-config cooldown + TOCTOU re-check pattern for auto-fetch concurrency.
- Fingerprint dedup: `activity-deduplicator.ts` (`toFixed(6)`), CSV-vs-Flex dedup.

## COMMANDS
```bash
pnpm install          # deps; approve esbuild build script if prompted
pnpm build            # vite → dist/addon.js
pnpm dev              # vite build --watch
pnpm dev:full         # build watch + dev-server.mjs on :3001
pnpm test             # vitest run — 1039 tests, ~5s
pnpm type-check       # tsc --noEmit — currently FAILS (test files only)
pnpm bundle           # clean + build + zip for release
```

## NOTES (gotchas)
- **Version compatibility (verified against wealthfolio/wealthfolio source):** host enforces `minWealthfolioVersion` only from app **v3.6.2+** (install/enable hard-fail; `2.0.0` always passes there); `sdkVersion` is **warn-only** (never blocks). SDK major tracks app major: app 2.x→SDK 2.0.0, app 3.x→SDK 3.x (current app 3.9.2 / SDK 3.9.0).
- **Route namespace (fixed 2026-10-09):** host ≥3.6.0 requires routes/sidebar under `/addon/<ns>` or `/addons/<ns>` (ns = addon id `ibkr-multi-import`). Now registered as `/addons/ibkr-multi-import/activities/import` + `/addons/ibkr-multi-import/settings/ibkr-flex` (`src/addon.tsx`). Old bare paths (`activities/import/ibkr-multi`, …) were rejected → `enable()` threw → blank sidebar.
- **`ctx.api.http` removed in SDK 3.9** — Flex fetch now goes through `createNetworkHttpClient(ctx.api.network)` (`src/lib/network-http-client.ts`, 60s default timeout, host cap 120s). Requires manifest `network: request` permission + `network.allowedHosts: ["ndcdyn.interactivebrokers.com"]` (install-time user consent gates actual calls).
- **SDK 3.9 type widening:** `ActivityImport`/`ActivityDetails` numeric fields are `number | string | null` unions; `QuoteSummary` removed (→ `SymbolSearchResult`); `ADD_HOLDING`/`REMOVE_HOLDING` dropped from `ActivityType`. Local helpers widened accordingly (`activity-deduplicator`, `types/index.ts`, `fx-transaction-splitter` coerces with `Number()`).
- Manifest permission guard keys must be exact: `market-data:searchTicker` (not `assets:`), `events:onUpdateComplete` (not `portfolio.onUpdateComplete`). Do NOT add `contributes` — it makes the addon lazy and breaks boot-time auto-fetch.
- **Every `ctx.api.*` call must appear in `manifest.json` or the sandbox rejects it** with a toast `Add-on permission denied ... tried to use 'X' without permission`. The allow-set is built from `permissions[].functions[].name` keyed `category:name` (`type-bridge.ts` `createPermissionGuard`); `ui`/`logger`/`query`/`toast` are baseline and need no declaration. Gotcha: the guard *category* often differs from the *namespace* — `ctx.api.market.searchTicker` is guarded as category `market-data`, and `events.portfolio.onUpdateComplete` is guarded per event group as `events`. `activities.getAll` is required by fingerprint dedup (`import-orchestrator.ts`, `auto-fetch-helpers.ts`) — omitting it fails the wizard's dedup step.
- **`activities.import` rejects the WHOLE batch if any row lacks `quoteCcy`/`instrumentType`** (host `activities_service.rs` step 3.5). Symbol-bearing rows (BUY/SELL/DIVIDEND/TAX with a real symbol) need both, or the host silently persists 0 rows *while still returning success* — which made the wizard report "31 imported" against an empty `activities` table. Cash movements (`$CASH-<ccy>` symbols) are exempt. `activity-converter.ts` therefore always stamps both on non-cash rows (`_resolvedQuoteCcy`/`_resolvedInstrumentType`, captured from `market.searchTicker`'s `currency`/`quoteType`, defaulting to the activity currency + `EQUITY`).
- **Never report success from the input array length**: `activities.import` resolves with an `ImportActivitiesResult.summary` whose `imported` count is what was persisted. Both the wizard and `auto-fetch-processor` must read that summary, otherwise a host-side rejection is indistinguishable from success.
- **Flex CSV column reality (live-verified against queryId 1666339, 2026-10-10):** a Flex response is 4 sections and has **no `LevelOfDetail`, no `Date`, no `ReportDate`** anywhere. Trades carries `TradeDate`; Cash Transactions carries `Date/Time` (values like `2026-06-30 202000`) which the splitter normalizes into `TradeDate`. Anything reading only `row.Date`/`row.ReportDate` sees nothing — fall back to `TradeDate`, and route every extraction through `normalizeActivityDate()` (`src/lib/shared-utils.ts`) so the trailing time never reaches `activities.import`.
- **Trades section lacks `TransactionType`/`Exchange`** unless the user enables them by hand (README's required list omits both), so `detectSectionType` keys on `Buy/Sell` alone and the preprocessor treats `Buy/Sell` without a transaction type as a stock trade.
- **Statement of Funds must be dropped at the splitter**, not left to preprocessor Rule 0.5: full statements mark those rows with `LevelOfDetail`, Flex SoFs do not, so its `ActivityCode=DIV/DEP` rows survived and double-counted every dividend/deposit (12 dividend activities for 6 real ones).
- `flex-query-fetcher` always calls the hardcoded `FLEX_API_BASE` (`ndcdyn`) and only *records* the `<Url>` from the SendRequest XML — which points at `gdcdyn`. Verified live: `ndcdyn` serves the statement fine, so `network.allowedHosts` needs only `ndcdyn` and must NOT add `gdcdyn`.
- Flex token/Query ID saved by the addon live in the host OS keyring under profile-scoped keys (`…:addon:ibkr-multi-import:flex_token` / `flex_query_id`); readable via `gi.repository.Secret` for live diagnostics — never print the token.
- Tests: 1064 pass, lib coverage 90.8%; but `csv-flexquery-deduplication.test.ts` fixtures live OUTSIDE the repo (`../../../../ibkrtogetherisa`) → tests silently no-op yet report "passed".
- Coverage config includes only `src/lib/**` — pages/components/hooks/entry have zero tests.
- Flex token is sent as URL query param (IBKR API design) — never print request URLs.
- `ibkr-csv-splitter.ts` throws if file has no Trades section; BOM breaks section detection (known limitation).
- README's required Flex transfer fields omit `TransferCompany`/`CashTransfer` which the parser requires — transfers silently skipped if user follows README.
