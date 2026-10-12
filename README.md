# Spreadsheet

## Supabase environment migration

New deployments must configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
`SUPABASE_SECRET_KEY`. The publishable key is used by browser/auth flows; the
secret key is restricted to privileged server operations.

Legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` environment names are
no longer accepted. A missing or malformed current key fails configuration
explicitly.

The `/api/runtime-config` response retains the `supabaseAnonKey` JSON property
for frontend compatibility. Its value comes from `SUPABASE_PUBLISHABLE_KEY` in
the new configuration, and the secret credential is never returned.

Affected endpoints and helpers:

- `/api/runtime-config` and `/api/login` use the publishable credential.
- Authorization token verification uses the publishable credential; profile
  role lookup and denied-request audit writes use the secret credential.
- `/api/activity-log` and `/api/kartu-stok` use the secret credential.
- Inventory synchronization for Kartu Stok, RPL, BULKY, Barang Masuk, and
  Barang Keluar uses the secret credential through the shared sync engine.

## Gmail identity for application CRUD

All application Google Sheets API handlers use the Gmail OAuth identity configured
in Supabase (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
`GOOGLE_OAUTH_REFRESH_TOKEN`), including movement, cycle count, transaction edits,
cell updates, Balikan Store, Barang Reject, and the application's PDF import.
The Gmail account needs Editor access to each spreadsheet and any protected ranges.
Google Sheets edit history uses that shared Gmail identity; WMS activity logging
continues to identify the application user separately.

Pages Functions call the server-only `app-google-auth` Edge Function using their
existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Supabase validates the server
key against its admin API before issuing a short-lived Google access token.
Publishable keys, browser sessions and anonymous callers cannot obtain a token.
Google credentials remain in Supabase; the application does not require
`GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, or copied OAuth secrets in Cloudflare.
Spreadsheet ID settings in Pages remain necessary and keep their existing mapping.
There is no fallback to the old service account if Gmail authentication fails.

Deploy `app-google-auth` with JWT gateway verification disabled (the handler checks
server credentials itself). The existing GitHub workflow deploys this function and
checks that unauthenticated requests receive HTTP 401. The Pages application must
also deploy the updated `functions/api` code. Secrets and tokens must never be
returned by an application API, logged, or placed in frontend runtime configuration.

## Production inventory schedule (Supabase Cron)

Supabase Cron is the scheduler only. Configure **five independent HTTP jobs**,
one for each existing per-source Cloudflare Pages Function. A Cron job must
invoke only one source, giving every sync a fresh Cloudflare Worker subrequest
budget. The jobs are staggered and must not be replaced by one job that calls
all sources, nor made concurrent.

| Job | Method and URL | Schedule (UTC) |
| --- | --- | --- |
| `inventory-kartu-stok` | `POST https://<domain>/api/sync/inventory/kartu-stok` | `0,30 * * * *` |
| `inventory-barang-masuk` | `POST https://<domain>/api/sync/inventory/barang-masuk` | `3,33 * * * *` |
| `inventory-barang-keluar` | `POST https://<domain>/api/sync/inventory/barang-keluar` | `8,38 * * * *` |
| `inventory-rpl` | `POST https://<domain>/api/sync/inventory/rpl` | `13,43 * * * *` |
| `inventory-bulky` | `POST https://<domain>/api/sync/inventory/bulky` | `16,46 * * * *` |

Set the following header on every job:

```text
Authorization: Bearer <INVENTORY_SYNC_SECRET>
```

These endpoints directly reuse the existing source services. Google Sheets
access, hashing/idempotency, per-source database locking,
`inventory_sync_status`, and sync history remain in the shared Cloudflare sync
engine. The individual manual sync behavior and the UI refresh path are
unchanged.

Replace `<domain>` with the production Cloudflare Pages custom domain. Set the
same strong `INVENTORY_SYNC_SECRET` value in the Pages production environment
and in every Supabase Cron request header. Do not put the real secret in this
repository.

`POST /api/sync/inventory/run` remains available for manual diagnostics only.
It executes all five sources in a single Worker invocation and can exceed
Cloudflare's subrequest limit. **Never use it as a production scheduler target.**

When the user explicitly presses the global Refresh button, the authenticated
application UI calls the five per-source endpoints sequentially: Kartu Stok,
Barang Masuk, Barang Keluar, RPL, and BULKY. Each endpoint accepts either the
normal application session or the scheduler secret. Separate Worker invocations
avoid Cloudflare subrequest/resource limits while retaining the low-pressure
sequential strategy. The browser never sends or receives
`INVENTORY_SYNC_SECRET`. `POST /api/sync/inventory/all` remains available for
diagnostics, but the application does not depend on that combined invocation.

Balikan Store, Asset, Arsip metadata, and Barang Reject were audited but are not
part of the database sync list: they are direct source-backed read APIs and have
no independent database sync service to orchestrate. Their active UI route is
still re-fetched after the five database syncs settle. Existing cron schedules
above are unchanged.

### Deployment and scheduler cutover

1. Deploy this repository as the existing Cloudflare Pages project. Do not
   deploy a separate Worker: this repository intentionally has no
   `wrangler.toml`, Scheduled Worker entry, Cron Trigger, or scheduler-only
   Durable Object.
2. Confirm the Pages production environment has `INVENTORY_SYNC_SECRET` plus
   the existing sync-engine variables (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   the deployed `app-google-auth` Edge Function, and `SHEET_ID_2026` or
   `GOOGLE_SHEET_ID`).
3. Before enabling Supabase Cron, delete/disable the former
   `wms-inventory-cron` Cloudflare Cron Trigger. Delete its scheduled Worker and
   scheduler-only `InventoryCronLock` Durable Object after confirming nothing
   else binds to it. These deployed resources are external state and are not
   removed by a Pages deployment.
4. Disable/delete any Supabase Cron job whose URL ends in
   `/api/sync/inventory/run` before enabling the five jobs above.
5. Smoke-test each per-source endpoint independently. Test an invalid bearer
   first and require HTTP 401, then send the valid bearer and require a
   successful response. Record the response `durationMs` for each source and
   confirm its row in `inventory_sync_status` has advanced. Inspect the
   corresponding Cloudflare log and confirm there is no `Too many subrequests`
   error.
6. Create and enable all five Supabase Cron HTTP jobs using the table above.
   Inspect their first invocations and confirm there are exactly five enabled,
   staggered schedules, no `/run` schedule, and no Cloudflare Cron Trigger.

Record production timings after the smoke test and after a representative
scheduled run:

| Source | Endpoint | Measured `durationMs` |
| --- | --- | --- |
| `kartu_stok` | `/api/sync/inventory/kartu-stok` | _record from production response_ |
| `barang_masuk` | `/api/sync/inventory/barang-masuk` | _record from production response_ |
| `barang_keluar` | `/api/sync/inventory/barang-keluar` | _record from production response_ |
| `rpl` | `/api/sync/inventory/rpl` | _record from production response_ |
| `bulky` | `/api/sync/inventory/bulky` | _record from production response_ |

The schedules above allow 3 minutes after `kartu_stok`, 5 minutes after each
heavy middle source, and 3 minutes after `rpl`. Increase the gap following any
source whose observed high-percentile duration approaches its allotted gap;
never start the next job while the previous heavy sync is likely to be active.

There are no Supabase Edge Functions and no sync implementation in Supabase.
Cloudflare Pages, Cloudflare API Functions, the shared inventory services, and
all individual manual sync endpoints remain deployed.
