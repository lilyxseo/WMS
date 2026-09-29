# Loading hotfix audit

## Dashboard

- Route initialization: `showPage("dashboard")` -> `loadDashboardPayload()`.
- Endpoints: `/api/dashboard-summary`, `/api/dashboard-recent-transactions`, and `/api/dashboard-monthly-insight`.
- Root cause: the summary endpoint materialized every row from five inventory tables before returning cards. Startup also launched independent sections as one aggregate lifecycle, so optional failures remained visually indistinguishable from loading.
- Fix: summary is now count-only; recent transactions select required columns and return at most 50 recent rows per source. Sections settle independently and render their own retry state.
- Auth is awaited with a 12-second bound. Request start, response status, API duration, auth duration, render duration, and controlled errors are logged without payloads or credentials.

## Cari Data

- Route initialization: `showPage("search")`; searches start in `runSearch()` only after a query reaches two characters.
- Endpoint: `/api/inventory-search?q=...&source=...`.
- Root cause: request/auth reads had no deadline and an exception only replaced the result text; there was no actionable retry. The route itself does not require the global inventory preload.
- Fix: the input shell is immediately usable, search remains server-side across SKU, name, and location fields, auth/network have a 12-second bound, stale generations cannot render, and errors show **Gagal memuat data / Coba Lagi**.

## Asset Store

- Route initialization: `showPage("asset-store")` -> `renderAssetStorePage()` -> `ensureAssetStoreList()`.
- Endpoints: Google Sheets spreadsheet metadata and values endpoints.
- Root cause: the generic route branch called `hydrateAllDataOnInit()` (full inventory, transactions, and movement) before rendering Asset. Asset then selected “all sheets” by default and used fail-fast `Promise.all`. Failed list requests recursively retriggered from render because an error was not part of the initialization guard.
- Fix: route initialization bypasses global hydration, the first asset sheet is the bounded default rather than all sheets, sheet failures settle independently, list retries do not loop, requests have a 12-second deadline, and explicit retry is available.

## Arsip

- Route initialization: `showPage("arsip")` -> `renderArchivePage()`; metadata loads after a spreadsheet is selected and values only after a sheet is selected.
- Endpoints: Google Sheets spreadsheet metadata and values endpoints.
- Root cause: the generic route branch waited for `hydrateAllDataOnInit()` even though Arsip does not consume inventory. A failed sheet-list request could also recursively start again on every error render.
- Fix: route shell bypasses global hydration, failed initialization is terminal until retry, values remain on-demand after sheet selection, requests have a 12-second deadline, and explicit retry is available.

## Timing interpretation

Production “before” values were not available in this repository and were not invented. The hotfix emits `[Dashboard]`, `[CariData]`, `[Asset]`, and `[Arsip]` events for `init`, `authReadyMs`, `requestStart`, `responseStatus`, `apiMs`, `renderMs`, and `error`. Dashboard/search APIs additionally return and safely log `authMs`, `dbMs`, `serializationMs`, `totalMs`, and `returnedRows`. These fields provide comparable post-deployment timing evidence without logging tokens, secrets, or datasets.
