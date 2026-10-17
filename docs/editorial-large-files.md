# General editorial files and large transfers

Baseline main: `1b7aa421c9f143d203938708e17733cb14f58b2a` (PR #56).
Branch: `feature/editorial-large-files`.

## Findings and limits

The old 1 GiB ceiling was a frontend `file.size > 1024**3` check plus Worker
`MAX_EDITORIAL_BYTES=1024*1024*1024`, not a Drive limit or D1 schema constraint.
Both layers also allowed only af/afpub/afdesign/afphoto. Existing uploads already
used a private Drive resumable session, 2 MiB canonical chunks, D1 reservations,
persistent checkout locks, chunk hashes and transactional version finalization.
Those mechanisms are retained instead of introducing a new storage service.

The application ceiling is now **20 GiB (21,474,836,480 bytes)**, with at most
10,240 canonical chunks and a 320 KiB tree-hash digest vector. This deliberate
bound controls final verification/query memory and metadata growth. It is not a
claim of unlimited support or a production-tested 20 GiB transfer. File sizes and
offsets use safe JavaScript integers and existing SQLite INTEGER columns.

Relevant upstream constraints:

- [Drive resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads): chunks must align to 256 KiB except the final chunk; sessions expire after a week. Existing 2 MiB chunks fit this protocol.
- [Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits): upstream file maximum 5 TB; Workspace upload allowance 750 GB/day, with account storage/permissions also applicable. The application does not promise that a particular account has enough free space.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 128 MB memory, plan-dependent request limits starting at 100 MB, no enforced response-body limit. Each upload request stays at 2 MiB and is bounded before allocation.
- [Vercel limits](https://vercel.com/docs/limits): external proxy requests have a 120-second limit. Whole multi-gigabyte downloads cannot reliably depend on one long proxied request.

## File policy and preservation

A shared policy removes extension allowlists, including from the file input.
INDD, IDML, ZIP, PSD, AI, images, arbitrary extensions and extensionless files are
accepted. There is no extraction, conversion, preview or execution. Bytes are
unchanged. Each Drive object still receives a unique project/version normalized
name; the exact original filename is retained in D1 and used for downloads via
RFC 5987 filename*. Old completed AFPUB versions remain readable.

Validation rejects paths, control/header characters, bidi spoofing controls,
ill-formed Unicode, Windows device names, trailing dots/spaces and overly long
names. All content is served as an attachment, application/octet-stream, with
nosniff. Arbitrary files are not asserted to be malware-free; no antivirus
service is introduced. Existing private access is the security boundary.

No tables, indexes, migrations, historical rows, original Drive files or folders
are changed or removed. No production DB backup/migration is required for this
code-only schema-compatible change. D1 migration files remain byte-for-byte
unchanged. No production test uploads, student data or real Slack messages.

## Upload, pause, recovery and cancellation

1. Read one 2 MiB slice at a time and compute the existing SHA-256-of-chunk-digests
   identity; show preparation progress. This requires two local file passes
   (hashing, then transfer), but never a whole-file ArrayBuffer/Blob upload.
2. Reuse the checkout-bound pending reservation. Original name, size, change note
   and full fingerprint must match on retry, including after reload/another
   device. No upload/session URL or Google token reaches the browser or storage.
3. Reconcile Drive's acknowledged offset. Canonical chunk hashes remain fixed;
   the Worker forwards only the missing suffix of a partially received chunk.
4. Retry transient network/408/429/5xx failures at most twice, with 500/1000ms
   backoff. Authorization, conflicts and validation errors are not retried.
   Chunk requests use a 90s browser deadline; Drive upload calls use 80s, keeping
   normal failure handling below Vercel's 120s proxy window.
5. A lost final reply may leave an already-complete Drive object whose resumable
   session no longer responds. Both status and final-chunk retries verify exact
   ID, name, parent, size and trashed state before recovering that completion.
6. Finalize only after Drive metadata and all canonical chunk digests verify.
   Existing transactional lock/latest-pointer/audit/Slack handling is preserved.
   Incomplete/cancelled reservations never appear as completed history.

Pause aborts hashing/backoff/current requests and keeps the pending D1 state and
lock; select the identical file and note to resume. The current form retains the
selected file when possible. Reload restores the pending change note from protected D1 metadata; only the
original file must be selected again. Pending metadata never includes session
URLs, tokens or user IDs. Google
login expiry requires logging back in to the same account before resuming;
authentication is not extended or bypassed. An expired Drive session reports a
clear error: cancel the checkout and start from the latest version again.

Confirmed upload cancellation uses the existing confirmed edit-cancel endpoint,
ends that lock and clears its pending pointer. It never deletes Drive objects or
old versions. If finalization won the race, the resulting completed version is
preserved; the UI instructs the user to check current state instead of promising
rollback. Slack failure cannot roll back a version or lock operation.

## Download architecture

For files below 64 MiB, the existing native browser attachment download remains.
Larger files use a small browser service worker registered only for
`/editorial-download/`, not `/`, `/admin/`, `/student/` or API scopes. The root
worker script is included in the actual frontend build, inherits noindex and
private/no-store headers, and contains no private identifiers/credentials.

The helper preflights the protected download-info API, then starts ordinary
navigation to an attachment response in the narrow download scope. A download
attribute must NOT be used for this large-file navigation: Chromium otherwise
bypasses the service worker. No page/frame cache or offline storage is used.

The browser download manager receives a ReadableStream. It writes to its normal
download destination while the helper fetches sequential 2 MiB HTTP ranges from
the existing authenticated download API. The Worker forwards Range to Drive,
verifies 206 and exact Content-Range/total, then streams the response. The browser
helper verifies each range length before emitting it, retries transient failures
without duplicating bytes and rejects corrupt range responses. No full-file
arrayBuffer or object URL is allocated. Each range reuses existing cookies,
admin membership, private caching and Drive authorization.

Download metadata contains only original/normalized names and size. Google
OAuth credentials and resumable URLs remain server-side. The service worker
intercepts only GET downloads, never caches responses, and does not alter
application navigation or login. A denied preflight leaves the UI in place.
Transfer failures mark the native download incomplete and notify the current UI.
Cancelling the browser download aborts in-flight range requests. Incoming browser
resume Range offsets are supported, but download-manager resume controls vary
by browser; restarting from the UI remains available.

## Validation and production boundary

Baseline default tests: Worker 257 / frontend 7 / policy 20 / browser 191 = 475.
Local full verification: Worker 267 / frontend 8 / deployment policy 20 /
browser 201 = 496 passed; no default-suite skips. Frontend build, validate and
diff checks pass. Relevant 390/820/1440 upload UI/flow checks pass in Chromium
and WebKit. The extended 20-case matrix is 19 passed / 1 WebKit download timeout:
[Playwright supports service workers on Chromium only](https://playwright.dev/docs/service-workers).
This automation limitation is recorded, not hidden with skip or an assertion
change. Safari large-download behavior remains unverified on a physical device.
The successful native streamed download test runs on Chromium/Chrome; ordinary
UI, file selection, pause, reload/resume and cancellation are cross-checked.

- Real repository hashing, bounded chunk processing, isolated SQLite/D1-shaped
  repository finalization and streaming download process **1 GiB + 17 bytes**
  (1,073,741,841 bytes, 513 chunks). Independent raw SHA-256 hashes match.
- A local real Chrome download writes that same byte count to disk through the
  download helper and 2 MiB range responses, with original Unicode filename and
  SHA-256 verification. It includes a simulated transient failure/retry.
- These are isolated/mocked Drive responses, NOT a real Google Drive transfer.
  20 GiB, production account storage/quota, long-lived real network transfers
  and physical iOS/Android devices remain unverified.
- Format, 64-bit offsets, invalid names/ranges, protected routes, incomplete
  versions, pause/resume/cancel, lost acknowledgements, unchanged checkout
  concurrency, metadata verification and existing security regressions are
  covered without production writes.

No new dependency, secret, OAuth scope, binding or public Drive permission is
required. After review/merge: deploy Worker first, then the matching Vercel build
(including editorial-download-worker.js). Existing automatic deployment already
uses that order. There is no production D1 migration or manual Pages deployment
for this feature. This task stops after commit/push/PR/CI; no merge or deploy.
