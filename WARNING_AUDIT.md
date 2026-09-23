# Inventory warning rule audit

## Enabled rules

All enabled rules are evaluated by `functions/api/_inventory-warnings.js` on complete Supabase tables loaded server-side. Summary and detail rows are derived from the same warning array.

| Category | Severity | Exact rule and authority |
|---|---|---|
| SKU Keluar Tanpa Data Masuk | High | A nonblank, NFKC/trim/case-normalized SKU exists anywhere in `inventory_barang_keluar`, but nowhere in `inventory_barang_masuk`; all statuses count as inbound evidence. |
| Nama Barang Tidak Konsisten | Medium | The same normalized SKU has more than one materially distinct NFKC/trim/collapsed-space/case-normalized name across all five inventory sources. Evidence lists source and original value. |
| SKU Kosong / Invalid | High | `sku` is NULL, empty, or whitespace in any authoritative source. No numeric-only format is assumed. |
| Nama Barang Kosong | Low | A row has a valid SKU but NULL/blank name. |
| Lokasi Kosong | Medium | A Kartu Stok, RPL, or BULKY row has numeric `stok_akhir > 0` and NULL/blank `lokasi_bulky`. Pseudo-locations are nonblank and are not flagged. |
| Stock Negatif | High | Kartu Stok `stok_akhir < 0`, matching the existing Stock Minus/backend analytics rule. |
| Accuracy Mismatch | High | Sum `selisih` by normalized SKU across RPL and BULKY and flag when the sum is not zero, exactly matching backend inventory accuracy aggregation. |

## Audited candidates not enabled

| Candidate | Decision |
|---|---|
| SKU Masuk tanpa master inventory; SKU Keluar tanpa master inventory | No single authoritative master is declared. Kartu Stok, RPL, and BULKY are operational sources, so choosing one would be speculative. |
| Stok akhir tidak sesuai rumus | No confirmed formula/sign/tolerance contract exists. |
| ISELLER missing | Fields exist, but no rule says when ISELLER is mandatory. |
| Referensi NETSUITE Kosong | The BULKY sync explicitly declares NETSUITE an optional header. Missing values are therefore not proven anomalies. Accuracy continues to use the established `selisih` field. |
| Duplicate SKU + location | Snapshot uniqueness is not documented; transaction/history rows may legitimately repeat. |
| Duplicate source row key | Sync upserts on `source_row_key`; database uniqueness is the authoritative protection. No user warning is added without evidence that duplicates can exist. |
| Future transaction date | No confirmed rule says future scheduling is prohibited. |
| Tanggal Invalid; QTY Invalid | The transaction tables exceed the reliable Cloudflare Worker read budget. These rules need database RPCs before they can be complete; browser or partial server scans are not used as a fallback. |
| Data source field mismatch | Name mismatch is enabled. Locations and unrelated quantities are not assumed identical. |
| Dokumen missing | No confirmed status/business-case requirement exists. |
| NO ISELLER / NETSUITE reconciliation | No established comparison semantics exist for transaction reference fields. |

The prior **Selisih stok keluar** comparison between raw Barang Keluar totals and Kartu Stok movement buckets remains disabled: those sources do not share an event key or guaranteed reporting scope. Duplicate transaction warnings from browser arrays are also not enabled because repeated ledger rows are not proven invalid.

## Query and refresh strategy

One authenticated `/api/inventory-warnings` request loads each complete snapshot source once (in parallel and in 1,000-row server-side batches). The cross-ledger "Keluar Tanpa Masuk" rule uses the existing complete database RPC, so the Worker never downloads the large transaction ledgers. It then applies backend search/filter/sort/pagination. No warning uses browser arrays, page caches, preloads, or a previously opened page. Search is case-insensitive, contains-based, multi-word AND matching. Sorting has a stable SKU/ID tie-breaker.

The endpoint returns unfiltered category/severity totals from the same computed warning collection as detail rows. Responses are `no-store`. Inventory-version changes revalidate the visible Warning page while preserving filter/page state and table scroll offsets. If a snapshot source is unavailable, no absence-based result is created from it. If the independent transaction RPC is unavailable, snapshot warnings remain usable and the omitted category is explicitly reported as partial.
