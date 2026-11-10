# Auto Insight Bulanan

The API and hydrated dashboard use `buildMonthlyInsight` for the same deterministic calculations. The warehouse date uses Asia/Jakarta, including around UTC month boundaries. Future transactions are excluded.

Current month-to-date is compared with day 1 through the same day in the previous month, clamped to that month's final day. Both date ranges are displayed. A zero prior baseline is labeled "Belum ada pembanding" rather than inventing a 100% increase.

Receipts and dispatches use the existing transaction status/reason fields. Movement/internal stock transfers are counted separately and excluded from receipt quantities, external flow and SKU ranking. Only positive, valid quantities with a valid date and SKU are included. Invalid-row counts are shown. The API reads paginated, bounded dates from the synchronized database; it does not issue full-sheet or per-SKU reads.

Four metrics show inbound quantity, outbound quantity, net flow and unique transacting SKUs. Net flow is not a stock balance. The daily chart displays individual inbound/outbound quantities. Top five outgoing SKUs include product name, quantity, share of current outgoing quantity, and comparison with that same SKU's previous-period quantity. Dispatches are described as outgoing stock, not sales.

Findings summarize flow imbalance, outgoing concentration, the busiest day and internal movements, with links to the relevant existing pages. Empty data does not imply stock is healthy. No stockout forecast, overstock judgment or dead-stock claim is inferred from transaction totals alone. "Dihitung" is the calculation timestamp, not a claim of live spreadsheet freshness.

The responsive view supports light/dark themes, keyboard-accessible chart values, native links, explicit empty states and expandable findings. Source text is escaped before insertion into HTML.
