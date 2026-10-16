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

Only browser tests and this investigation record change. No product CSS, UI, Worker, authentication, D1 or deployment configuration changes. PR #54's Drive redirect:manual remains intact.

A shared test helper waits for the injected theme and document.fonts.ready, then reads editor, footer, counter, toolbar and overflow in one synchronous browser evaluation. The original strict counterTop >= editorBottom assertion remains, with additional footer containment and toolbar checks. No epsilon, skipped assertion, fixed sleep or retry-based overlap allowance is introduced. The existing sidebar/counter checks reuse the helper.

Student and administrator geometry is covered at 360/390/430/768/820/1440px, initially and after input. Screenshots and numeric JSON attachments are saved by Playwright. A delayed-theme/font plus scroll regression reproduces -39px from mixed snapshots while verifying the real +13px gap. A negative control translates the counter upward and confirms the geometry assertion rejects a genuine overlap.

## Validation scope

Chromium 153.0.8010.12 (same version as the failed CI run) and WebKit cross checks: 26 passed. The 390px test and deterministic race/negative-control test repeated 10 times per engine: 40 passed. Physical phones and the exact Linux CI event timing are not reproduced; real browser engines and the production-built frontend run with isolated API fixtures.

No production data, migration, credentials or settings are changed. No merge/deploy is performed. The complete default browser suite gains 10 cases (177 -> 187).

Final results: Worker 257 / frontend 7 / deployment scripts 19 / complete Chromium browser suite 187: 470 passed. Frontend build, validate and diff checks passed. Existing writing/save/submit, security and editorial-file regressions passed. Files changed: this record and worker/browser/editor-text.spec.js only.
