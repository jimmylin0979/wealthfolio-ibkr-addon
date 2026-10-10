import { describe, it, expect } from "vitest";
import { parseFlexQueryCSV } from "../lib/flex-csv-parser";
import { detectCurrenciesFromIBKR } from "../lib/currency-detector";

describe("Flex Query zero-currency regression", () => {
  // README-conformant Flex CSV (no LevelOfDetail column)
  const flexCsvNoLod = [
    '"ClientAccountID","CurrencyPrimary","AssetClass","Symbol","ISIN","TradeID","DateTime","TradeDate","Quantity","TradePrice","Proceeds","Taxes","IBCommission","NetCash","Buy/Sell","TransactionID","TransactionType","Exchange"',
    '"U123","USD","STOCK","AAPL","US0378331005","T1","20250102;093000","2025-01-02","10","150","1500","0","-1","1499","BUY","9001","ExchTrade","NASDAQ"',
    "",
    '"ClientAccountID","CurrencyPrimary","Date/Time","Amount","Type","TransactionID"',
    '"U123","USD","2025-01-03","50","Dividends","9002"',
  ].join("\n");

  // Flex CSV where the user ALSO included the LevelOfDetail field
  const flexCsvWithLod = [
    '"ClientAccountID","CurrencyPrimary","AssetClass","Symbol","ISIN","TradeID","DateTime","TradeDate","Quantity","TradePrice","Proceeds","Taxes","IBCommission","NetCash","Buy/Sell","TransactionID","TransactionType","Exchange","LevelOfDetail"',
    '"U123","USD","STOCK","AAPL","US0378331005","T1","20250102;093000","2025-01-02","10","150","1500","0","-1","1499","BUY","9001","ExchTrade","NASDAQ","EXECUTION"',
    "",
    '"ClientAccountID","CurrencyPrimary","Date/Time","Amount","Type","TransactionID","LevelOfDetail"',
    '"U123","USD","2025-01-03","50","Dividends","9002","Detail"',
  ].join("\n");

  // IBKR error/XML payload accidentally parsed as CSV
  const xmlPayload =
    '<?xml version="1.0"?>\n<FlexStatementResponse timestamp="x">\n<Status>Fail</Status>\n<ErrorCode>1014</ErrorCode>\n</FlexStatementResponse>';

  it("A) README Flex CSV (no LevelOfDetail)", () => {
    const parsed = parseFlexQueryCSV(flexCsvNoLod);
    const currencies = detectCurrenciesFromIBKR(parsed.rows);
    console.log("A rows:", parsed.rows.length, "errors:", parsed.errors, "currencies:", currencies);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(currencies).toContain("USD");
  });

  it("B) Flex CSV WITH LevelOfDetail column (user-added field)", () => {
    const parsed = parseFlexQueryCSV(flexCsvWithLod);
    const currencies = detectCurrenciesFromIBKR(parsed.rows);
    console.log("B rows:", parsed.rows.length, "errors:", parsed.errors, "currencies:", currencies);
    expect(currencies).toContain("USD");
  });

  it("C) XML payload (query format=XML by mistake)", () => {
    const parsed = parseFlexQueryCSV(xmlPayload);
    const currencies = detectCurrenciesFromIBKR(parsed.rows);
    console.log("C rows:", parsed.rows.length, "errors:", parsed.errors, "currencies:", currencies);
    expect(parsed.rows.length).toBe(0);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});

describe("Flex section-splitting regression (live-verified 2026-10-09)", () => {
  // Shape mirrors the real queryId 1666339 response: 4 sections, trades
  // WITHOUT TransactionType/Exchange, plus a Statement of Funds section.
  const realShapedCsv = [
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","Symbol","Description","ISIN","ReportDate","Date","SettleDate","ActivityCode","ActivityDescription","Debit","Credit","Amount","TransactionID"',
    '"U123","USD","1","VOO","VOO Cash Dividend","US9229083632","2026-06-30","2026-06-30","2026-06-30","DIV","Cash Dividend","","0.2","0.2","T1"',
    '"U123","USD","1","","Electronic Fund Transfer","","2026-06-17","2026-06-16","2026-06-17","DEP","Electronic Fund Transfer","","100","100","T2"',
    "",
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","TradeID","DateTime","TradeDate","SettleDateTarget","Quantity","TradePrice","Proceeds","Taxes","IBCommission","NetCash","Buy/Sell","TransactionID"',
    '"U123","USD","1","STK","VOO","VANGUARD S&P 500 ETF","US9229083632","9951","2026-07-28 104848","2026-07-28","2026-07-29","13","67.77","-881.01","0","-1.000039","-882.010039","BUY","T3"',
    "",
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","Date/Time","SettleDate","Amount","Type","TransactionID"',
    '"U123","USD","1","STK","VOO","VOO(US9229083632) CASH DIVIDEND USD 1.9622 PER SHARE - US TAX","US9229083632","2026-06-30 202000","2026-06-30","-0.06","Withholding Tax","T4"',
    '"U123","USD","1","STK","VOO","VOO(US9229083632) CASH DIVIDEND USD 1.9622 PER SHARE","US9229083632","2026-06-30 202000","2026-06-30","0.2","Dividends","T5"',
  ].join("\n");

  it("trades section without TransactionType/Exchange is recognized via Buy/Sell", () => {
    const parsed = parseFlexQueryCSV(realShapedCsv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rowCount).toBe(3); // 1 trade + 2 cash; SoF excluded
    expect(detectCurrenciesFromIBKR(parsed.rows)).toEqual(["USD"]);
  });

  it("Statement of Funds rows are excluded to prevent dividend/deposit double-count", () => {
    const parsed = parseFlexQueryCSV(realShapedCsv);
    const sofDiv = parsed.rows.filter(
      (r) => r.ActivityCode === "DIV" && r.ActivityDescription === "Cash Dividend"
    );
    const sofDep = parsed.rows.filter((r) => r.ActivityCode === "DEP");
    expect(sofDiv).toHaveLength(0);
    expect(sofDep).toHaveLength(0);
    const cashDiv = parsed.rows.filter((r) => r["Notes/Codes"] === "Dividends");
    expect(cashDiv).toHaveLength(1);
  });
});

describe("Flex TradeDate conversion regression (live-verified 2026-10-09)", () => {
  const flexCsvWithTradeDate = [
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","TradeID","DateTime","TradeDate","SettleDateTarget","Quantity","TradePrice","Proceeds","Taxes","IBCommission","NetCash","Buy/Sell","TransactionID"',
    '"U123","USD","1","STK","VOO","VANGUARD S&P 500 ETF","US9229083632","9951","2026-07-28 104848","2026-07-28","2026-07-29","13","67.77","-881.01","0","-1.000039","-882.010039","BUY","T1"',
    "",
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","Date/Time","SettleDate","Amount","Type","TransactionID"',
    '"U123","USD","1","STK","VOO","VOO(US9229083632) CASH DIVIDEND USD 1.9622 PER SHARE","US9229083632","2026-06-30 202000","2026-06-30","0.2","Dividends","T2"',
    '"U123","USD","1","","Electronic Fund Transfer","","","2026-06-16","2026-06-17","100","Deposits/Withdrawals","T3"',
  ].join("\n");

  it("converts rows whose only date field is TradeDate (no Date/ReportDate columns)", async () => {
    const { parseFlexQueryCSV: parse } = await import("../lib/flex-csv-parser");
    const { preprocessIBKRData } = await import("../lib/ibkr-preprocessor");
    const { convertToActivityImports } = await import("../lib/activity-converter");
    const parsed = parse(flexCsvWithTradeDate);
    const { processedData } = preprocessIBKRData(parsed.rows);
    const conversion = await convertToActivityImports(processedData, [
      { currency: "USD", name: "T - USD", group: "T" },
    ]);
    expect(conversion.errors).toEqual([]);
    expect(conversion.activities).toHaveLength(3);
    const dates = conversion.activities.map((a) => a.date);
    expect(dates).toContain("2026-07-28");
    expect(dates).toContain("2026-06-30");
    expect(dates).toContain("2026-06-16");
    // Every activity date must be a bare ISO date; the Cash Transactions
    // section arrives as "YYYY-MM-DD HHMMSS" and must not reach the host.
    for (const d of dates) {
      expect(String(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("Host import-contract regression (quoteCcy / instrumentType)", () => {
  const tradesCsv = [
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","TradeID","DateTime","TradeDate","SettleDateTarget","Quantity","TradePrice","Proceeds","Taxes","IBCommission","NetCash","Buy/Sell","TransactionID"',
    '"U123","USD","1","STK","VOO","VANGUARD S&P 500 ETF","US9229083632","9951","2026-07-28 104848","2026-07-28","2026-07-29","13","67.77","-881.01","0","-1.000039","-882.010039","BUY","T1"',
    "",
    '"ClientAccountID","CurrencyPrimary","FXRateToBase","AssetClass","Symbol","Description","ISIN","Date/Time","SettleDate","Amount","Type","TransactionID"',
    '"U123","USD","1","","Electronic Fund Transfer","","","2026-06-16","2026-06-17","100","Deposits/Withdrawals","T2"',
  ].join("\n");

  it("stamps quoteCcy/instrumentType on symbol rows and omits them on cash rows", async () => {
    const { parseFlexQueryCSV: parse } = await import("../lib/flex-csv-parser");
    const { preprocessIBKRData } = await import("../lib/ibkr-preprocessor");
    const { convertToActivityImports } = await import("../lib/activity-converter");

    const parsed = parse(tradesCsv);
    const { processedData } = preprocessIBKRData(parsed.rows);
    const { activities } = await convertToActivityImports(processedData, [
      { currency: "USD", name: "T - USD", group: "T" },
    ]);

    const buy = activities.find((a) => a.activityType === "BUY");
    const deposit = activities.find((a) => a.activityType === "DEPOSIT");

    // Without these the host rejects the ENTIRE batch (activities land nowhere)
    // while still reporting success, so they must always be present.
    expect(buy?.quoteCcy).toBe("USD");
    expect(buy?.instrumentType).toBe("EQUITY");
    expect(deposit?.symbol).toMatch(/^\$CASH-/);
    expect(deposit?.quoteCcy).toBeUndefined();
    expect(deposit?.instrumentType).toBeUndefined();
  });
});
