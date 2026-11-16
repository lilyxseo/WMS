# Movement delivery and recovery

Movement submissions use immutable snapshots with a stable batch UUID. The active
form immediately starts a new draft; completing, failing, or reconciling an older
batch never clears that draft. The owner-scoped local journal and revisioned
account draft retain batch inputs and statuses. Switching accounts suppresses old
callbacks and does not move their batches into the new account.

`POST /api/movement/in` requires `{id, items}` and a verified PIC/Developer session.
It uses the existing `stock_entry_batches` receipt table, with `kind: movement`
and a hash including the module name. No new migration is required. A unique ID
and conditional run claim prevent concurrent/replayed requests from writing twice.
If the existing receipt table is unavailable, no spreadsheet write starts.

Each spreadsheet write is an atomic `appendCells` plus `createDeveloperMetadata`
request: Inventory's `Movement` tab and 2026's `Barang Masuk` tab each retain a
`wms_movement_<batch UUID>` receipt. SKU values are explicitly strings, preserving
leading zeros. Appending avoids a full-sheet read and cannot overwrite a different
batch's chosen empty row. The two spreadsheets are independent transactions.
Only confirmation of both is a full success.

The UI reports **Sedang dikirim**, **Berhasil**, **Gagal**, or **Belum terkonfirmasi**.
A proven failure before any writes permits retry of the same ID and snapshot.
Network errors, refresh during delivery, partial writes, and unknown outcomes do
not automatically POST again. Use **Periksa status** to GET the batch status.
The server reconciles uncertain outcomes by reading both spreadsheet receipts;
it does not write missing destinations or repeat the original transaction. If
only one receipt exists, keep the batch locked and inspect both spreadsheets
before any manual correction. Absence of a receipt during an in-flight request
is not proof that nothing was written. Legacy uncertain drafts retain their
existing explicit History verification dialog.

The server's existing operation audit remains in use. Its metadata refresh runs
through the existing middleware. The browser does not perform a full inventory
sync or replace the page after delivery. Identical autosave payloads are ignored,
including while a cloud draft write is in progress.

Cycle Count searches `/api/cycle-count/search`, sharing Movement's authenticated
server stock lookup. Neither route initializes a full stock-card preload. Numeric
queries of at least two characters start immediately; name/location queries use
an 80 ms debounce. New queries cancel and supersede old responses. Nonzero stock
balances, including negatives, retain the existing Cycle Count rules.

## Validation

Run `node --test --test-concurrency=4 tests/*.test.mjs` from the checkout. The
regressions cover slow/failed delivery, double confirmation, new drafts during
old requests, account switching, cloud conflicts, persistent receipt replay,
partial writes, and recovery after a lost response or final database checkpoint.

The optional `tests/movement-browser.cjs` exercises the actual UI and grid in
Chromium with mocked authentication and APIs. It checks background delivery,
new-draft persistence after completion and reload, idle DOM stability, stale
Cycle Count results, and retry controls. It never writes production data.
Install `playwright-core@1.58.2` outside the checkout, start the staged app with
Wrangler, then run (adjust the external tool/build paths as needed):

```sh
NODE_PATH=/workspace/.wms-tools/node_modules \
WMS_BROWSER_BUILD_DIR=/workspace/.wms-build \
WMS_BROWSER_BASE_URL=http://127.0.0.1:8790 \
node tests/movement-browser.cjs
```

The runner defaults to `/usr/bin/chromium`; override `CHROMIUM_PATH` if needed.
