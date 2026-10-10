/**
 * Regression coverage for re-importing an unchanged IBKR statement.
 *
 * The host deduplicates via a SHA-256 idempotency key
 * (`build_import_idempotency_key`) that fingerprints |quantity|, |unit_price|,
 * |amount| and |fee|. When every row of a batch already exists, the host
 * resolves successfully with imported: 0, skipped: N, duplicates: N — which the
 * addon used to report as "N failed".
 */
import { describe, it, expect } from "vitest";
import type { ActivityImport } from "@wealthfolio/addon-sdk";
import {
  createActivityFingerprint,
  createExistingActivityFingerprint,
  filterDuplicateActivities,
} from "../lib/activity-deduplicator";
import { accountHostImport } from "../lib/shared-utils";

const withdrawal: ActivityImport = {
  accountId: "acc1",
  date: "2026-03-04",
  symbol: "$CASH-USD",
  activityType: "WITHDRAWAL",
  quantity: 250,
  unitPrice: 1,
  amount: 250,
  currency: "USD",
  fee: 0,
  comment: "",
  isDraft: false,
  isValid: true,
};

describe("host idempotency-key parity", () => {
  it("matches a stored withdrawal whose amount sign was flipped by the host", () => {
    const stored = createExistingActivityFingerprint({
      activityDate: "2026-03-04",
      assetId: "$CASH-USD",
      activityType: "WITHDRAWAL",
      quantity: 0,
      unitPrice: 0,
      amount: -250,
      fee: 0,
      currency: "USD",
      comment: "",
    });
    const incoming = createActivityFingerprint(withdrawal);

    expect(incoming).toBe(stored);
    expect(filterDuplicateActivities([withdrawal], [{
      activityDate: "2026-03-04",
      assetId: "$CASH-USD",
      activityType: "WITHDRAWAL",
      quantity: 0,
      unitPrice: 0,
      amount: -250,
      fee: 0,
      currency: "USD",
      comment: "",
    }]).duplicates).toHaveLength(1);
  });

  it("matches a stored fee whose sign was flipped by the host", () => {
    const stored = {
      activityDate: "2026-03-04",
      assetId: "$CASH-USD",
      activityType: "FEE",
      quantity: 0,
      unitPrice: 0,
      amount: -1.23,
      fee: -1.23,
      currency: "USD",
      comment: "IBKR commission",
    };
    const incoming: ActivityImport = {
      ...withdrawal,
      activityType: "FEE",
      amount: 1.23,
      fee: 1.23,
      comment: "IBKR commission",
    };

    expect(filterDuplicateActivities([incoming], [stored]).duplicates).toHaveLength(1);
  });

  it("matches a stored sell whose quantity the host normalised to positive", () => {
    const sell: ActivityImport = {
      accountId: "acc1",
      date: "2026-03-04",
      symbol: "AAPL",
      activityType: "SELL",
      quantity: -10,
      unitPrice: 150.25,
      amount: 1502.5,
      currency: "USD",
      fee: 1,
      comment: "",
      isDraft: false,
      isValid: true,
    };
    const stored = {
      activityDate: "2026-03-04",
      assetId: "AAPL",
      activityType: "SELL",
      quantity: 10,
      unitPrice: 150.25,
      amount: 1502.5,
      fee: 1,
      currency: "USD",
      comment: "",
    };

    expect(filterDuplicateActivities([sell], [stored]).duplicates).toHaveLength(1);
  });

  it("still separates genuinely different activities", () => {
    const other: ActivityImport = { ...withdrawal, date: "2026-03-05" };
    expect(filterDuplicateActivities([other], [{
      activityDate: "2026-03-04",
      assetId: "$CASH-USD",
      activityType: "WITHDRAWAL",
      quantity: 0,
      unitPrice: 0,
      amount: 250,
      fee: 0,
      currency: "USD",
      comment: "",
    }]).duplicates).toHaveLength(0);
  });
});

describe("accountHostImport", () => {
  it("reports an all-duplicate batch as skipped, not failed", () => {
    expect(
      accountHostImport({ total: 12, imported: 0, skipped: 12, duplicates: 12, success: true }, 12)
    ).toEqual({ imported: 0, duplicates: 12, failed: 0 });
  });

  it("reports a partial duplicate batch without inflating failures", () => {
    expect(
      accountHostImport({ total: 12, imported: 5, skipped: 7, duplicates: 6, success: true }, 12)
    ).toEqual({ imported: 5, duplicates: 6, failed: 1 });
  });

  it("reports a validation rejection as a failure", () => {
    expect(
      accountHostImport(
        { total: 12, imported: 0, skipped: 12, duplicates: 0, success: false, error_message: "Validation errors found in activities." },
        12
      )
    ).toEqual({ imported: 0, duplicates: 0, failed: 12 });
  });

  it("counts writer-policy skips as failures", () => {
    expect(
      accountHostImport({ total: 4, imported: 2, skipped: 2, duplicates: 0, success: true }, 4)
    ).toEqual({ imported: 2, duplicates: 0, failed: 2 });
  });

  it("never produces a negative failure count from a malformed summary", () => {
    expect(
      accountHostImport({ total: 4, imported: 4, skipped: 9, duplicates: 9, success: true }, 4)
    ).toEqual({ imported: 4, duplicates: 9, failed: 0 });
  });

  it("treats a missing summary as a total failure rather than a silent success", () => {
    expect(accountHostImport(undefined, 3)).toEqual({ imported: 0, duplicates: 0, failed: 3 });
  });
});