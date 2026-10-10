import { CsvRowData } from "../presets/types";
import { getCurrencyForExchange } from "./exchange-utils";

const ISO_CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Detects all unique currencies from IBKR CSV data
 *
 * IBKR exports have two sections:
 * - Section 1 (summary): Shows currency breakdown with LevelOfDetail = "Currency"
 * - Section 2 (transactions): Shows all transactions with base currency in CurrencyPrimary
 *
 * Two-tier detection:
 * 1. Primary: ONLY summary rows (LevelOfDetail = "Currency") from a full Activity
 *    Statement's Cash Report are read to get the actual currency list.
 * 2. Fallback: When no summary rows exist (e.g. Flex Query CSVs, which never contain
 *    a Cash Report section), currencies are derived from ALL transaction rows
 *    (regardless of any LevelOfDetail value they may carry):
 *    - EXCHANGE_TO_CURRENCY[ListingExchange] for trades and TTAX/OFEE taxes/fees
 *    - CurrencyPrimary (statement base currency) when it is an uppercase ISO-3 code
 *    - Both halves of an FX pair symbol (e.g. "HKD.USD") for IDEALFX rows only,
 *      never from ordinary dotted symbols like "BRK.B"
 *
 * @param parsedData - Array of parsed CSV rows
 * @returns Sorted array of unique currency codes
 */
export function detectCurrenciesFromIBKR(parsedData: CsvRowData[]): string[] {
  const currenciesSet = new Set<string>();

  for (const row of parsedData) {
    // ONLY read from summary section rows (LevelOfDetail = "Currency")
    // This avoids picking up column names or base currency from transaction section
    if (row.LevelOfDetail === "Currency") {
      const currency = row.CurrencyPrimary?.trim();
      if (currency && currency.length > 0 && currency !== "Currency") {
        currenciesSet.add(currency);
      }
    }
  }

  // Fallback: no summary rows means the file has no Cash Report section
  // (Flex Query CSVs, or statements where the user omitted it). Derive
  // currencies from ALL transaction rows instead — Flex queries commonly
  // carry LevelOfDetail values like "EXECUTION"/"Detail" on every row,
  // so the fallback must not filter on LevelOfDetail.
  if (currenciesSet.size === 0) {
    for (const row of parsedData) {
      collectRowCurrencies(row, currenciesSet);
    }
  }

  // Convert to array and sort alphabetically
  return Array.from(currenciesSet).sort();
}

/**
 * Collects the currencies a single transaction row contributes:
 * - FX pair halves for IDEALFX rows (Symbol like "HKD.USD")
 * - The mapped ListingExchange currency (trades, TTAX/OFEE taxes/fees)
 * - CurrencyPrimary when it is a valid uppercase ISO-3 code (base currency)
 */
function collectRowCurrencies(row: CsvRowData, currenciesSet: Set<string>): void {
  const isIdealFx =
    row.Exchange?.trim() === "IDEALFX" || row.ActivityDescription?.trim() === "IDEALFX";

  if (isIdealFx && row.Symbol) {
    for (const part of row.Symbol.split(".")) {
      if (ISO_CURRENCY_PATTERN.test(part)) {
        currenciesSet.add(part);
      }
    }
  }

  const exchangeCurrency = getCurrencyForExchange(row.ListingExchange);
  if (exchangeCurrency) {
    currenciesSet.add(exchangeCurrency);
  }

  const primary = row.CurrencyPrimary?.trim();
  if (primary && primary !== "Currency" && ISO_CURRENCY_PATTERN.test(primary)) {
    currenciesSet.add(primary);
  }
}

/**
 * Counts transactions per currency, mirroring the detection fallback rules:
 * each row counts toward the mapped ListingExchange currency when present,
 * otherwise toward CurrencyPrimary (when non-empty and not the literal
 * "Currency" header value). Rows with neither are skipped.
 *
 * Kept in the same file as detectCurrenciesFromIBKR so counting and
 * detection stay in lockstep.
 *
 * @param parsedData - Array of parsed CSV rows
 * @returns Map of currency code to transaction count
 */
export function countTransactionsByCurrency(parsedData: CsvRowData[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const row of parsedData) {
    const currency = getCurrencyForExchange(row.ListingExchange) ?? fallbackPrimaryCurrency(row);
    if (!currency) {
      continue;
    }
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }

  return counts;
}

function fallbackPrimaryCurrency(row: CsvRowData): string | undefined {
  const primary = row.CurrencyPrimary?.trim();
  if (primary && primary !== "Currency") {
    return primary;
  }
  return undefined;
}
