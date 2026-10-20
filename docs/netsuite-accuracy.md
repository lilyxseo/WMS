# NetSuite stock accuracy

`public.netsuite` is an independent read model of `2 SOH NETSUITE` in the spreadsheet configured by `SHEET_ID_2026` (fallback `GOOGLE_SHEET_ID`). The sync detects the report headers, including the usual row 4, and preserves actual source row numbers and the report date. It imports SKU, name, opening/closing balances and the four movement columns. It never edits Google Sheets or WMS transaction ledgers.

`POST /api/sync/inventory/netsuite` uses the existing authenticated per-source sync engine, locks, hashes, history and size guards. An invalid row or empty report rejects the entire new snapshot. Blank closing balances remain unknown instead of becoming zero. NetSuite participates in manual source refresh and the database settings list.

The private `inventory_netsuite_accuracy` RPC sums `inventory_kartu_stok.stok_akhir` across locations and `netsuite.saldo_akhir` per normalized SKU. It uses a full join so missing SKUs are visible. Difference is Kartu Stok minus NetSuite. Missing sources/balances are not compared and do not enter the accuracy denominator. Total absolute difference prevents positive and negative discrepancies canceling each other. Both source sync statuses must be successful and unlocked before comparison data is exposed. The report date and both sync times are shown; synchronization does not change the report's business date.

The authenticated `/api/inventory-accuracy` endpoint returns this aggregated snapshot, avoiding browser downloads of full RPL/BULKY tables. SKU/name/location search, status filtering, sorting and paging operate on the complete response. The legacy RPL/BULKY accuracy cache is no longer used.

Deployment uses the existing GitHub Supabase management credential to install the migration, verify RLS, wait for the website endpoint, and enqueue one initial sync through the existing Kartu Stok scheduler configuration. No credential is exposed in the browser, repository or output. After a successful initial sync, `inventory-netsuite` runs at minute 20 and 50 each hour using Supabase Cron. Existing inventory and notification schedules are preserved.
