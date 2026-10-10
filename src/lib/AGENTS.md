# src/lib — PIPELINE KB

## OVERVIEW
22 pure TS modules + `network-http-client.ts` adapter (23 total), no index.ts: the IBKR → Wealthfolio transform pipeline (parse → classify → resolve → convert → split → dedup → import), mirrored 1:1 by vitest suites in `src/__tests__/`.

## STRUCTURE
- Parse: `ibkr-csv-splitter.ts` (multi-section merge + header normalization), `flex-csv-parser.ts` (Flex CSV → CsvRowData, reuses splitter), `ibkr-preprocessor.ts` (row classification, emits `_IBKR_TYPE`, drops IDEALFX).
- Detect/name: `currency-detector.ts` (reads only `LevelOfDetail="Currency"` rows), `account-name-generator.ts` (`{group} - {ccy}`).
- Ticker resolve: `ticker-resolution-service.ts` (batch orchestration, 50ms delay), `ticker-resolver.ts` (4-tier ISIN→Yahoo, localStorage cache, max 1000 entries).
- Convert: `activity-converter.ts` (rows → ActivityImport, FX-rate lookup, position history), `dividend-utils.ts`, `exchange-utils.ts` (`EXCHANGE_TO_CURRENCY`), `fx-transaction-splitter.ts` (FX trade → withdrawal+deposit pair).
- Dedup: `activity-deduplicator.ts` (fingerprints).
- Orchestration: `import-orchestrator.ts` (`processAndResolveData`: preprocess → resolve → convert → splitFX; dedup + group helpers), `auto-fetch-processor.ts` (per-config fetch → import hand-off), `auto-fetch-helpers.ts` (cooldown, status, error enrichment).
- Infra: `flex-query-fetcher.ts` (2-step SendRequest/GetStatement `v=3`), `flex-config-storage.ts` (JSON in `ctx.api.secrets`), `async-lock.ts`, `constants.ts`, `shared-utils.ts`, `validation-utils.ts`, `debug-logger.ts`.

## WHERE TO LOOK
| Task | Open |
|---|---|
| Amount/fee/tax math, new activity type | `activity-converter.ts` (`mapActivityType`, `VALID_ACTIVITY_TYPES`) |
| Dividend per-share parsing (shared converter+dedup) | `dividend-utils.ts` |
| CSV vs Flex duplicate mismatch | `activity-deduplicator.ts` |
| IBKR section detection / column renames | `ibkr-csv-splitter.ts` (`detectSectionType`, `normalizeHeaders`) |
| Row classification rules | `ibkr-preprocessor.ts` |
| ISIN/symbol → Yahoo ticker | `ticker-resolver.ts`, `ticker-resolution-service.ts` |
| FX conversion splitting | `fx-transaction-splitter.ts` |
| Flex API, error codes, polling | `flex-query-fetcher.ts` (`FLEX_ERROR_CODES`) |
| Config CRUD / storage races | `flex-config-storage.ts` |
| Auto-fetch flow, cooldown, toasts | `auto-fetch-processor.ts`, `auto-fetch-helpers.ts` |
| Timeouts/limits tuning | `constants.ts` |

## CONVENTIONS
- Deps injected, not imported from host: `setHttpClient(createNetworkHttpClient(ctx.api.network))` (SDK 3.9 brokered network), `SecretsAPI` param, `searchFn`, `activitiesApi`. Only `auto-fetch-processor.ts` receives `AddonContext` and touches `window.__wealthfolio_toast__`.
- Types come from `@wealthfolio/addon-sdk`, `../types`, `../presets/types`; never re-declare SDK shapes.
- Logging: `debug-logger.ts` (gated by `localStorage.IBKR_DEBUG === "true"`) or injected `ctx.api.logger`.
- Module-level mutable state: fetcher's `httpClient`, storage's `configLock`; every config write goes through `withLock` (read-modify-write).
- Row-level failures return result objects (`ConversionError[]`, `SkippedFXConversion[]`); throw only for structural failures.

## INVARIANTS / ANTI-PATTERNS
- Reads use `loadConfigsSafe`, never `loadConfigs` (deprecated: returns `[]` on error, indistinguishable from "no configs").
- Never log tokens or full request URLs: token rides in `?t=TOKEN`.
- Money math never rounds silently: amounts are `Math.abs` of raw parses; only fingerprints normalize (`toFixed(6)`).
- Fingerprint format `date|symbol|type|<qty|unitPrice for trades | perShare for dividends | amount (+comment for FEE)>|fee|currency`. `createActivityFingerprint` and `createExistingActivityFingerprint` must stay in lockstep or CSV-vs-Flex dedup breaks.
- `buildFXRateLookup` must run on raw rows before preprocessing: preprocessing converts FX trades to TRANSFER pairs and loses rates.
- Missing date → conversion error, never defaulted. Missing `CurrencyPrimary` IS silently defaulted to `"USD"` (`ibkr-preprocessor.ts:705,720,756,846`, `activity-converter.ts:392`) — grouping itself never injects a currency.
- `flex-csv-parser.ts` must keep reusing `extractTradesSection` so Flex and CSV rows hit the identical conversion/dedup path.
- Sanity caps: FX rates ≤ `MAX_FX_RATE` (1000), per-share dividend ≤ `MAX_REASONABLE_DIVIDEND_PER_SHARE` (10000).

## NOTES
- `extractTradesSection` throws `No trades section found` / `No valid IBKR sections found`; a BOM breaks detection (headers matched via `line.startsWith('"ClientAccountID"')`).
- `addConfig`/`updateConfig`/`deleteConfig` read via `loadConfigsOrThrow` (fixed 2026-10-09): a read error now throws instead of yielding `[]`, which previously let `saveConfigs` wipe all stored configs.
- Token is an IBKR-designed URL query param; redirect `<Url>` from XML is accepted only if https on `*.interactivebrokers.com` / `*.ibkr.com`.
- Retryable Flex codes: 1003/1019 (generating), 1018 (rate limit); backoff 2s→30s, absolute timeout 2min, else fail fast.
- Every `ActivityImport` with a real (non-`$CASH-`) symbol must carry `quoteCcy` and `instrumentType`; the host drops the entire import batch when one row lacks them, yet still resolves successfully, so a wizard run can report "imported N" with an empty activities table. `convertToActivityImports` stamps these from `_resolvedQuoteCcy`/`_resolvedInstrumentType` (set in `ticker-resolution-service.ts` from `market.searchTicker`'s `currency`/`quoteType`).
- Never count an import as successful from the submitted array length — read `ImportActivitiesResult.summary.imported`. The host validates each row and can skip the whole batch; the wizard and `auto-fetch-processor` both surface the discrepancy as a failed count.
- Statement of Funds rows are dropped in `detectSectionType` (`ActivityCode` + `ActivityDescription` + `Debit`/`Credit`) — Flex SoFs carry no `LevelOfDetail`, so preprocessor Rule 0.5 cannot skip them and they would double-count every dividend/deposit.
- `detectSectionType` identifies Trades by `Buy/Sell` alone; README's required-field list omits `TransactionType`/`Exchange`, so requiring all three rejected valid Flex CSVs ("No trades section found" → 0 rows → misleading "Detected 0 currency").
- Never read a date from only `row.Date`/`row.ReportDate`: Flex CSVs have neither. Trades carry `TradeDate`; Cash Transactions `Date/Time` is normalized into `TradeDate` and arrives as `YYYY-MM-DD HHMMSS`. Every date extraction in `activity-converter.ts` must go through `normalizeActivityDate()` (`shared-utils.ts`), which strips the time component (also accepts compact `YYYYMMDD`) and returns `""` for anything unparseable so the "missing date is never defaulted" guard fires. Dedup fingerprints are safe independently — `activity-deduplicator.normalizeDate` re-extracts `YYYY-MM-DD` via regex.
- `detectCurrenciesFromIBKR` must keep its transaction-row fallback: Flex responses have no `LevelOfDetail="Currency"` (Cash Report) rows at all, so the primary path alone returns `[]`.
- Transfers section needs `Direction`+`TransferCompany`+`CashTransfer` headers, else classifies `unknown` and rows drop (README omits two of these).
- Dividend fallback chain: perShare×position → FX rate → base currency + pushed as `ConversionError` (surfaced, not silent).
- Dedup field-diff logging caps at `MAX_DEBUG_LOGS` (5) per run.
