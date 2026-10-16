# Editorial project creation hotfix

## Verified cause

The frontend sends the expected integer year and Summer/Winter season to the existing admin-only POST route. Before writing D1, `EditorialFiles.create()` calls the private Drive folder adapter. Its shared request helper used `redirect: 'error'`, introduced in `8eb879b6`. Workers/workerd supports only `follow` and `manual`, so it throws before making the Google request. The outer Worker handler turns this unclassified TypeError into `500 / Unexpected server error.`

The new regression executes the actual editorial router, Drive adapter and timeout helper on workerd with isolated D1 and mocked outbound Google traffic. Before the fix its create request fails with:

`Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).`

Existing Node tests mocked global fetch, accepting this option without the Workers runtime validation.

## Production read-only checks (2026-10-16)

- main: `dbe8de6879975d526fcb2ed02a3eb6273854863b`.
- Worker: `d7c10bab-1e38-4555-99b0-c154aeda5cd8`, 100%, tagged with the same main commit, deployed October 13.
- D1 `editorial-production`: 0001–0008 recorded; no pending migrations. Read-only sqlite_master inspection confirms editorial_projects schema matches 0006. Query metadata reports zero writes.
- Unauthenticated session GET: 200; project list GET: 401; both no-store.
- Live filtered error tail was attempted but captured no matching event. No authenticated production create was replayed, and no historical failure stack was recovered. Existing Worker error logging records code/status only. The exact exception above comes from isolated workerd reproduction, not a claimed production stack trace.
- Automatic approval review rejected a production create POST diagnostic; it was not sent. Only GET requests were used afterward.

## Minimal change and validation

Use `manual` and retain existing response-status checks. Redirects are rejected without following the target or forwarding its bearer token. Resumable upload 308 acknowledgement handling is preserved. No auth, scope, folder ownership, schema, data, or UI changes.

The runtime test verifies first create, saved private folder metadata, duplicate 409 without another Drive call, invalid input 400, 302/307/403/500 failures as 502, no redirect target calls, and preservation of existing D1 rows. Existing upload/lock/version/concurrency/security tests remain in place.

Merge requires Worker deployment through the existing pipeline. No migration or frontend change is necessary. This branch is not deployed.

Other uses of redirect:error in Slack and photo-thumbnail code are outside this project-creation hotfix and remain unchanged; they merit a separate runtime-backed fix.

Validation: Worker 257 / frontend build tests 7 / deployment scripts 19 passed. Frontend build, Worker dry-run build, validate and diff checks passed. The first Chrome run passed 176/177: a pre-existing menu autofocus race in the photo-modal test required waiting for the initial navigation focus before explicitly focusing Upload. The test retains its assertions and additionally verifies the initial focus. No UI implementation was changed. The focused test passed five consecutive runs; the final full Chrome run passed 177/177. Final total: 460 tests passed.
