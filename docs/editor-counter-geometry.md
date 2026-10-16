# Editor counter geometry regression

Baseline main: `7422f739f1adec212d834be3bce3273393658309` (PR #54).
Failed release: https://github.com/jdlions/jdlions.github.io/actions/runs/38886443204

## Finding

The failure compared editor bottom 913.78125 with counter top 874.78125 from two separate awaited Playwright boundingBox calls. Each rectangle uses viewport coordinates, but asynchronous theme/font loading, reflow or scrolling may occur between those calls. The test only awaited editor visibility and counter text; neither guarantees the injected theme/font is ready or that both snapshots share the same viewport/layout.

Controlled actual-build reproduction in Chromium 153:

- Withheld the dynamically injected liquid-glass stylesheet: same-frame counter gap remained 13px before and after release. Combining measurements across that reflow falsely reported overlap (approximately -251px).
- With the ready page, 52px of scrolling between the old independent reads reproduces the CI difference exactly: 13 - 52 = -39px. Same-frame measurement still reports +13px.
- The CI log contains no scroll/layout event trace, so it cannot identify which exact intervening event occurred in that run. The reproducible defect is the measurement race; no actual counter overlap was found. Before changing the test, normal Chrome and Chromium runs each passed the original 390px test 15 times.

## Change

The counter geometry fix changes only browser tests and this investigation record; the subsequent focused campaign-control lifecycle fix is documented below. Neither fix changes CSS, Worker, authentication, D1 or deployment configuration. PR #54's Drive redirect:manual remains intact.

A shared test helper waits for the injected theme and document.fonts.ready, then reads editor, footer, counter, toolbar and overflow in one synchronous browser evaluation. The original strict counterTop >= editorBottom assertion remains, with additional footer containment and toolbar checks. No epsilon, skipped assertion, fixed sleep or retry-based overlap allowance is introduced. The existing sidebar/counter checks reuse the helper.

Student and administrator geometry is covered at 360/390/430/768/820/1440px, initially and after input. Screenshots and numeric JSON attachments are saved by Playwright. A delayed-theme/font plus scroll regression reproduces -39px from mixed snapshots while verifying the real +13px gap. A negative control translates the counter upward and confirms the geometry assertion rejects a genuine overlap.

## Validation scope

Chromium 153.0.8010.12 (same version as the failed CI run) and WebKit cross checks: 26 passed. The 390px test and deterministic race/negative-control test repeated 10 times per engine: 40 passed. Physical phones and the exact Linux CI event timing are not reproduced; real browser engines and the production-built frontend run with isolated API fixtures.

No production data, migration, credentials or settings are changed. No merge/deploy is performed. The complete default browser suite gains 10 cases (177 -> 187).

Initial counter-fix results: Worker 257 / frontend 7 / deployment scripts 19 / complete Chromium browser suite 187: 470 passed. Frontend build, validate and diff checks passed. Existing writing/save/submit, security and editorial-file regressions passed. Files changed: this record and worker/browser/editor-text.spec.js only.


## Follow-up: campaign filter removed during a pending search

PR check run 38889541424 failed in compact-articles.spec.js, 1440px, while clearing the campaign filter immediately after clearing search. The log shows the option was found, then became detached during click actionability checks.

This is a product interaction defect: the 300ms debounced search finishes and calls article-list paint(), which unconditionally closes and rebuilds the campaign selector even when its options have not changed. A human opening the dropdown during the debounce can likewise lose the open menu.

A paused-clock regression opens the real admin campaign menu, then advances the existing search debounce exactly 300ms. Before the fix, the menu ID disappears and the visibility assertion fails. After the fix, the same menu and focused option survive and a normal click clears the campaign value. No force click, new retry or timeout increase is used.

article-list.js now retains the campaign control when the option IDs/names/order are unchanged. It synchronizes a changed selected value without recreating the menu. Actual metadata changes still close and replace stale options. The list's cancellation, sequence and debounce behavior is unchanged. compact-articles.spec.js scopes selection to the trigger's aria-controls menu and verifies the selected value.

New 390/820/1440px tests cover search/clear while open, mouse and keyboard selection, combined grade/type/status/campaign filters, refreshed option labels/additions, empty results and reset to all students. Chromium/WebKit cross checks: 14 passed. Original 1440px scenario plus deterministic regression repeated five times each in Chromium: 10 passed. The earlier counter geometry fix and Drive redirect:manual remain unchanged. No Worker/D1/auth/deployment configuration changes.

Combined local validation after the filter fix: complete Chromium suite 190 / Worker 257 / frontend 7 / deployment scripts 19: 473 passed. Frontend build, validate and diff checks passed. GitHub checks must additionally pass for the new PR head.
