# Advance Search and outbound location review

`/advance-search` searches the existing inventory index by SKU/name. Choose a result or open an exact SKU to inspect a SKU that exists only in Reject/audit history. It displays all existing Detail SKU source columns, both Reject ledgers, Movement history, paginated Cycle Count, stock accuracy, notes and available catalog images. Each source loads independently and failed sources offer retry. No additional-sheet manual search is implemented.

Ordinary `/sku/<sku>` no longer requests or displays Reject history. Reject source data, editing routes, and Reject pages are retained.

The `OUTBOUND_LOCATION_WITHOUT_INBOUND` warning reviews every positive outbound row whose nonempty `(SKU, From)` is absent from inbound `(SKU, To)`. SKU remains a string (leading zeros matter); case and outer whitespace are normalized. Any inbound status/date counts. Quantities are not balanced against each other. Evidence includes the outbound date, source row, From, To and Qty. This is always **perlu verifikasi**: opening balances and incomplete history can explain the missing evidence.

Apply `supabase/migrations/20261103000000_outbound_location_inbound_review.sql` before refreshing the warning snapshot. The existing warning-snapshot deployment workflow now includes this migration and triggers on its changes. It replaces only the service-role review RPC; it does not change transaction rows. Atomic and ordinary warning reads both reuse that RPC. The new finding is emitted only after inbound and outbound snapshots are verified (existing From checks additionally require Kartu Stok). Existing SKU-wide history review remains separate.

Local validation covers mocked service APIs, PostgreSQL query behavior, and browser interactions. A push does not by itself establish a successful Cloudflare Pages or Supabase production deployment. Verify the deployment workflows and a fresh warning snapshot before claiming this behavior is live on gotoliving.app.

## Additional historical sources

Advance Search also provides independent, read-only sections for:

- Both Barang Masuk and Barang Keluar tabs in the configured Kartu Stok 2025 archive.
- `SO JULI 2025` in the configured Inventory spreadsheet.
- Both tables in `COUNT 1` in the registered archive named `SO 2026`. `SO_2026_SPREADSHEET_ID` can select this spreadsheet explicitly; the client cannot provide arbitrary spreadsheet IDs.
- Every TRIP tab discovered from Inventory, using the existing Balikan Store parser and preserving extra source columns.

`/api/advance-search-sources?source=ledger2025|so2025|so2026|trips&sku=...` requires a session and returns only exact-SKU matches. Historical tables retain source sheet, table number, original row and business columns. Header positions are discovered rather than fixed to the first table. COUNT 1 fails explicitly if fewer than two header blocks are recognized. Partial sheet parsing failures remain visible and retryable. No source data is edited.

The local machine has no Supabase/Google runtime credentials. Historical-layout tests use representative fixtures; the actual COUNT 1 headers/ranges and SO 2026 registration must still be checked against the real spreadsheet before claiming live-source validation.
