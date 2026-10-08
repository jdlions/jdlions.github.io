# Assignment length rules and queue PNG export

Baseline: `4c5d8ca74a9c03ca6ad98f85114cf0428fb1279c` (PR #45 merged).

## Counting and submission

`character-count.js` contains the existing PR #44/#45 `editorText` and
`characterCount` functions. `editor-text.js` re-exports them for both editors.
Spaces, repeated spaces, one LF per paragraph boundary/BR, and CRLF normalization
are retained; `Intl.Segmenter('ko', {granularity:'grapheme'})` counts visible
characters. HTML comments contribute no text or extra boundary.

The Worker uses `parse5` solely to build an HTML5 tree (including named/numeric
entities and malformed legacy HTML), removes the same unreadable elements as the
editor, and passes a DOM-compatible adapter to those same functions. It is not
shipped in frontend assets. Existing sanitization/paste handling is unchanged.

Campaigns store nullable `min_characters` and `max_characters`. Null/null means
disabled; either bound may be omitted, zero is allowed, and two bounds require
min < max. Existing assignments remain unlimited. Saving drafts is always allowed
outside the range. Only submission is blocked with `article_length_out_of_range`.
The server re-counts the saved student draft. Submission atomically compares the
validated draft, status, current assignment limits and assignment open state before
creating its immutable revision and changing status. Concurrent changes return 409.

## Existing submission review

- `POST /api/assignments/:id/length-preview`: proposed limits, read-only report and
  an authenticated ten-minute preview token bound to actor, campaign, limits and
  ordered submission snapshot.
- `POST /api/assignments/:id/length-apply`: token, same limits and `confirmation:
  "반려"`. The UI additionally requires expanding targets, typing confirmation and
  a final dialog stating bounds and unique student/article counts.
- Both endpoints reuse admin authorization, trusted Origin, CSRF and no-store.
- The latest **student submission/resubmission revision** is counted, never the
  teacher's edited draft or an import revision. Missing submission history is
  reported without guessing or modifying the article.
- Only `submitted` and `reviewing` may be returned as `revision_requested`.
  `approved` and `scheduled` are informational only. Draft, already returned,
  hold, and closed assignments are not automatically returned.
- The server re-reads and recalculates targets. A D1 atomic batch first checks the
  ordered article/status/update/revision snapshot and campaign limits/update time.
  A CHECK guard rolls back the entire batch if anything changed after the read.
  New submissions, deletions, status changes or new revisions require another preview.
- Successful actions have an immutable `assignment_length_reviews` audit record;
  the token nonce also prevents duplicate application. Each target receives a
  normal status-change revision and a student-readable reason appended to existing
  feedback. Internal notes and all student submissions are preserved.
- Saving/changing/disabling limits alone never changes article status.

## PNG

The export button uses the list controller's completed filtered snapshot, including
all matching students, rather than the visible viewport. It is unavailable during
loading/debounce/failure. Existing overview filtering and school-number ordering
remain the source of truth. As in the queue, real nonmatching companion slots are
retained and explicitly marked `조건 외` rather than mislabeled as missing.

Canvas creates a 1200px-wide PNG with dynamic height, wrapping names/assignment
titles, a local-time timestamp, the existing same-origin gold wordmark and footer.
Only school number, display name and school/feature status enter rows. Status
labels and computed colors come directly from the existing `statusBadge` CSS.
Multiple slots appear as multiple statuses; missing slots say `미제출`.
No extra article/API request or server upload is made. Zero results produce a
message rather than an empty image. Filenames are normalized. Very large results
over the 30,000px canvas height guard request narrower filters.

## Deployment / rollback

1. After explicit approval and merge, apply **only 0008** to `editorial-production`.
2. Deploy the merged Worker and verify session/auth, assignment limits, preview and
   student submit behavior using nonproduction fixtures or authorized safe data.
3. Verify the same commit on Vercel. Coordinate automatic frontend rollout with
   migration/Worker availability; new controls must not be used against the old API.
4. No GitHub Pages, Drive, OAuth, secret or index changes are required.

The additive migration is compatible with the old Worker (old inserts omit nullable
columns). The new Worker requires 0008. Keep the added columns/audit table during
rollback; dropping them is unnecessary. An old Worker does not enforce newly set
limits, so roll back frontend first and do not resume limited submissions on an old
Worker without an explicit operational decision. Never replay bulk actions as part
of deployment or rollback.

## Verification

Baseline: Worker 213, frontend/build 5, Chrome 116; existing Edge editor coverage 21.
New tests exercise actual Worker routes with isolated SQLite/D1-adapter fixtures,
transaction-race rollback, source revision selection, replay, role/CSRF/Origin,
HTML/grapheme parity, real frontend initialization and Canvas download.
No production records, submissions, Drive files or secrets are used or modified.

Final coverage: Worker 241, frontend/build 5, Chrome 133, Edge 38 (417 checks).
Chrome's full existing suite passed; the final PNG privacy adjustment was rechecked
with the complete new-feature suite in Chrome and Edge. Edge also covers all 21
existing editor text/paste/sidebar tests. Build, validate, diff-check and Worker
dry-run bundling passed. The actual 20-student PNG is 1200 × 2231px; logo, Korean,
wrapped long names/title, original status colors and footer were visually checked.
390/820/1440px screenshots and no-horizontal-overflow assertions passed.
Opaque ID fallbacks, emails and raw identity search text are excluded from output.
