# Student submission comparison

Baseline: `4e8ebb9d75f69b35175e2d953191557a00c241aa` (PR #46).
This frontend PR is independent of the production deployment workflow PR.

## Data and UI

The existing authenticated article-detail response already includes revisions.
No new API, migration, table, query or extra article fetch is needed. Only
`authorRole: student` and `revisionKind: submission/resubmission` records enter
comparison. Teacher editor saves/status checkpoints and student import drafts
are excluded. Revision number, timestamp and ID provide stable ordering.

`수정 내용 비교` is disabled with an explanation before a second student submission
exists. The default pair is the latest and immediately preceding submission;
all older student submissions remain selectable. The modal shows the title,
timestamps, previous/current/added/removed grapheme counts and body changes.
Current unsaved editor text is not a submission and is never used or replaced.

HTML is converted with the existing readable HTML + editorText functions, so
paragraphs, BRs, CRLF normalization, repeated spaces and Unicode follow the
existing manuscript counter. Original records are never rewritten. All comparison
text and metadata enter the DOM via textContent/createTextNode. No original HTML
is interpolated into the diff markup; scripts, SVG and external attributes are
removed by the existing sanitization path before conversion.

## Algorithm and performance

`Intl.Segmenter('ko', {granularity:'word'})` produces Korean/English word tokens
while retaining whitespace/punctuation/newlines. A prefix/suffix trim and bounded
Myers diff compute changed tokens. At most 250,000 work steps and edit distance
400 are used. A large replacement falls back to deleting/adding the remaining
changed region, explicitly labeled as grouped output; it does not truncate text
or silently show an inaccurate fine-grained comparison.

Over 50,000 combined text characters are calculated in a same-origin module Web
Worker. Changing the selected revision terminates the old worker; a sequence guard
prevents old results from painting. Closing the modal terminates it. Errors and a
10-second deadline produce a clear retry state rather than indefinite loading.
Legacy comparisons above 600,000 combined text characters / 2,000,000 combined
HTML characters stop with a size message before expensive tokenization/parsing.
This covers the normal existing 300,000-character-per-draft limit, while protecting
against oversized historical imports. Original files/data remain untouched.

Local synthetic measurement: 299,999 characters / 531,431 UTF-8 bytes per manuscript,
one localized change: **188ms**, 4 output runs, no coarse fallback. A large unrelated
replacement completed with grouped fallback in **98ms**. These are local Node
measurements, not a production device guarantee. Browser tests verify actual
background calculation and UI recovery; the long example completed within 5s.

Added text uses green + underline + `＋ 추가`; removed text uses red + strike-through
+ `− 삭제`, so color is not the only signal. Space-only/newline changes have explicit
labels. Long unchanged runs can be expanded and next/previous change controls move
keyboard focus to the highlighted run. Reduced motion disables smooth scrolling.
The existing dialog helper provides focus entry/trap/return, Escape and scroll lock.

## Verification and deployment

Baseline coverage: Worker 241, frontend/build 5, Chrome 133, selected Edge 38 = 417.
This PR: Worker **256**, frontend/build **5**, Chrome **150**, selected Edge **55** =
**466**, all passed. New coverage includes actual isolated D1 submission records,
300 generated lossless token-edit cases, first/multiple resubmissions, teacher/import
exclusion, Korean/English/Unicode, spaces/newlines, HTML/XSS, modal keyboard, unchanged
body, long/oversized text, background failure and stale-result protection.
Full existing suites passed; after the final modal styling adjustment the complete
17-case feature suite was rechecked in Chrome and Edge. 390/820/1440 screenshots,
no horizontal overflow, close-button readability and visual inspection passed.
Build, validate and diff-check also passed. No new dependency was added.

Without the automation PR, this feature needs the normal Vercel frontend deployment;
it changes no Worker API/runtime or D1 schema. With the automation PR configured and
merged, its next main merge follows the ordered release workflow automatically.
PR #46's outstanding production 0008/Worker mismatch must still be resolved using
that approved release flow. No production account, record, lock, upload, Slack
message, migration or deployment was changed during implementation.
