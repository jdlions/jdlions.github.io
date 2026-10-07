# Branding refinement and complete admin article overview

Baseline: `f1de1c60116cf0ac6e7b92c16f391b5f8955aff1` (PR #42). Production login served PR #42's versioned white logo when work started.

## Branding

Keep the supplied source PNGs intact. Derive a dark variant from the gold artwork: light Pride/back page, original gold Desk/front page and gradient. Lossless WebP avoids approximating the raster gradient with newly drawn vector paths or embedding a PNG in SVG.

- 480×111 wordmark: 26,506 B; 960×222: 66,224 B.
- 128×128 symbol: 7,310 B. Visible bounds (21,11)–(107,117) share the canvas center (64,64). The login icon uses a 48px square inside its centered 54px container.
- Login hero and compact admin/student headers use the color variant; mobile headers use the square symbol. Favicon/social assets and public newspaper branding remain unchanged.
- Previous default login white wordmark+symbol: 31,996 B; new wordmark+symbol: 33,816 B. Original full-size files are not fetched. Existing build-hash versioning and cache/noindex policy remain intact.

## Data and filters

`GET /api/admin/article-overview` requires the existing authenticated admin role. It combines the existing configured Classroom roster (five-minute Worker cache) with one D1 metadata projection over assignment slots/recipients and standalone articles. Roster-only students appear even with no articles; historical assignment recipients, including grade 3, are preserved.

Response: `{students:[{studentId,name}],items:[{id,studentId,articleType,titleKo,titleEn,status,campaignId,assignmentName,updatedAt,submittedAt,authorName}],campaigns:[{id,name}]}`. No bodies, previews, feedback, internal notes, revision history, Drive file IDs or photo metadata are selected. One D1 query regardless of student count; a cold roster can make Google metadata calls through the existing timeout/cache policy. No index/migration required.

Only admin article management uses the complete overview. Student lists and photo pickers retain the existing bounded cursor API. Admin search/type/status/campaign/student/date/grade filters operate on the complete metadata snapshot without more API/COUNT requests. Search remains debounced 300ms; AbortController and request sequence protect initial fetch/refresh/navigation. Refresh refetches metadata; local mutations invalidate via the existing list revision. Detail return preserves filters.

Grade uses a standalone five-digit school number in the display name, never an opaque Google ID. Unknown accounts remain in all grades. Status counts match the existing facet meaning: all other filters apply, selected status is excluded from the status breakdown. Cards always show school/feature; real nonmatching articles are dimmed with an explanatory note rather than falsely labeled missing. A slot with no article in the full snapshot says 미제출. Multiple historical articles are preserved instead of silently collapsed.

## Measurements (isolated synthetic D1, not production student data)

The fixture includes assigned students, two article slots each, one assigned student with no article, and an additional roster-only unknown account. Before means retrieving every existing summary page, not just the first page.

| Assigned students | Before API requests | After | Before D1 queries | After | Before JSON bytes | After |
|---|---:|---:|---:|---:|---:|---:|
|20|2|1|4|1|17,071|13,582|
|100|10|1|12|1|89,409|70,062|

Admin startup remains session + dashboard only; article overview is lazy. Measurements count list queries, excluding existing authentication and cold Google roster requests.

At 1440×900, the same 20-student/40-article UI fixture was rendered using baseline HTML/JS/CSS and the new build. First-card height: 951.875px → 175.563px; cards starting within the viewport: 3 → 6. The old body excerpt and prominent destructive action made narrow nested cards tall. New layout uses two wider columns and short school/feature rows; 390px uses one column. These are fixture measurements, not claims about every production title length.

## Validation and rollout

Coverage includes all students, missing sides, no preview, long/XSS titles/types, grade/compound filters, metadata counts, deletion confirmation, detail return, timeout/retry, no stale navigation writes and responsive overflow. Existing authentication/privacy, editor autosave, private photo/picker, assignment, Affinity/Slack, publication/archive, cache and noindex regressions remain in the full suite.

After merge, deploy the Worker first (new read endpoint), then confirm the same merge commit's Vercel frontend. No D1 migration, secret change, GitHub Pages change or guide update is required. Deploying the frontend first temporarily produces an article-overview error on an older Worker; it does not fall back to an incomplete first page. No merge or production deployment is part of this PR.
