# Production browser validation stability

Baseline: `c737261cff72ff392c8faca863c294d0b58c4115` (PR #55 merged).
Branch: `fix/deployment-browser-stability`.
Scope: tests, validation configuration and investigation only. No product runtime,
Drive redirect, campaign dropdown fix, D1, authentication or release adapter changes.

## Failed releases and reproducible causes

- Production #8 / run 38886443204: independently awaited viewport bounding boxes
  compared editor bottom 913.78125 and counter top 874.78125. Theme/font reflow or
  scrolling between those reads makes the coordinates incomparable. Controlled
  mixed-scroll reads reproduce 13 - 52 = -39px while same-frame geometry has a
  positive 13px gap. The original run did not retain a trace, so the precise event
  between its reads cannot be reconstructed. No genuine overlap was reproduced.
- PR #55 also fixed a genuine campaign-dropdown defect: the debounced list paint
  detached an unchanged open selector. That product fix and its paused-clock
  mouse/keyboard regression remain intact.
- Production #9 / run 38903878725: the replacement diagnostic still considered
  theme `sheet` and `document.fonts.ready` sufficient rendering readiness. They
  do not wait for finite CSS transitions. On the built page with delayed theme
  and font delivery, the composer controls transition their padding and wrap
  from two rows to one. In ten Chrome new-headless probes, topbar height changed
  142.59375 -> 87.796875 and document height 1332 -> 1278. The requested scroll
  immediately became 52, then browser scroll anchoring moved it to 0 over the
  next rendered frames. The counter gap stayed 13px throughout.
- A diagnostic-only control disabling overflow anchoring preserved scroll 52
  through the same height change (two probes). That override is NOT in the
  product or regression tests. The fix waits for the real transition to finish.

The older standalone Chromium headless shell passed the old diagnostic 20 times,
as did WebKit (20). Chrome new-headless exposed the transition reliably. Browser
mode matters even when an installed Chromium version matches; a successful
repetition alone is not proof that the transition race has been removed.

## PR versus production CI

PR run 38902619218 (success) and production #9 used the same Ubuntu 24.04.5 image
20261012.334.1, Node 24.21.0, lockfile Playwright 1.63.0 and Chrome for Testing
153.0.8010.12 / revision 1243. Both installed Chromium with dependencies, used one
worker and the `chromium` channel, with no test-step environment override. The
production provider secrets are scoped to the later release step, not tests.
The PR runs on a pull-request ref, production on the merge commit; their relevant
lockfile, browser config and workflows were identical. A different GITHUB_SHA
only changes deployment.json metadata, not UI layout. There is no evidence of a
Node/browser dependency mismatch causing these failures.

Previously production ran validate before browsers, and PR after browsers; the
same npm browser script was called from different working directories. Those
are not the reproduced cause, but duplicated gates can drift. Both workflows now
invoke one local composite validation action, in exactly the same order, on
ubuntu-24.04 with Node 24, npm ci and explicit PLAYWRIGHT_CHANNEL=chromium.
The production release still stops on any validation failure.

The shared gate prints a whitelist of runtime identifiers (not environment dumps
or secrets). Browser installation logs record the downloaded revision. Browser
failure traces, screenshots, error context and geometry diagnostics are retained
for seven days. Retries remain zero; CI forbids accidental test.only. No changes
to deployment concurrency, migrations, secret handling or provider actions.

## Test synchronization and defect detection

The editor geometry helper waits for the injected stylesheet, fonts and all
finite active animations to naturally complete, then reads all rectangles in one
synchronous evaluation. It excludes infinite decorative animations, never changes
or disables CSS transitions, and does not retry failed layout assertions.
A held finite animation regression confirms that a measurement cannot finish
before its transition is released and completed. Before asserting a persistent absolute scroll offset, the diagnostic also waits
for the autosave queued by input: its status text can change toolbar wrapping.
This uses the existing saved-state contract, not a fixed 900ms sleep.
The scroll diagnostic verifies
scrollable extent, immediate 52px scroll and the subsequent 52px snapshot. The
exact gap/mixed-origin checks remain. A deliberately translated counter must
still fail the strict overlap assertion. Sidebar credit bounds also wait for rendering and are
read together in one frame, eliminating the same independent-snapshot pattern.
No sleeps, force clicks, assertion
allowances, timeout increases, skips or retry loops were added.

The audit also reviewed font readiness, mobile screenshot/geometry paths,
branding image readiness, dropdown bounds, fake-clock search/debounce tests and
article-list request sequence/cancellation. No additional defect explaining the production release failures was
confirmed; the extended WebKit paste finding is recorded below. These tests are not made to wait globally: doing so could deadlock
intentionally paused clocks or hide fetch/loading states. The readiness change is
limited to the demonstrated geometry dependency. Existing campaign DOM/race
coverage is retained rather than duplicated.

## Validation and limits

Complete local default suite: Worker 257 + frontend 7 + deployment policy 20 +
browser 191 = 475 passed (baseline 473); no skips/retries. The full browser suite
ran with CI=true and Chrome new-headless through the repository configuration,
including failure-trace recording. Frontend build, validate and diff checks pass.
The 390px built-page screenshot also shows the counter below the editor.

Extended editor + campaign-filter cross suite: 112/117 passed across Chromium
153 headless-shell, Chrome 155 new-headless and WebKit. All geometry, scroll,
finite-transition and campaign-filter cases pass. Five additional WebKit paste
cases fail with one extra trailing newline. Running those five unmodified tests
from origin/main reproduces all five failures: insertHTML produces, for example,
`<p>첨삭<br>English<br></p>` with a final BR (11 instead of 10 characters).
This is a pre-existing WebKit contenteditable/paste behavior, not introduced by
this stabilization. Tests are NOT skipped or weakened, nor is the product paste
or counting behavior changed to make the expanded suite green. The normal CI
suite is Chromium-only; WebKit paste compatibility remains an explicit issue
outside this deployment-test correction.

All browser traffic uses
isolated API fixtures; no production write requests are made. Local Node is
24.19.0 on Windows. Chromium 153 headless-shell, Chrome 155 new-headless and
WebKit cross-checks cannot fully substitute for the hosted Linux/Chromium 153
new-headless runner. No local Linux distribution is installed.

A local repetition was invalidated by rebuilding dist while its browser server
was running: the newly retained trace shows eleven JavaScript module requests
returning 404 during dist replacement, before the editor could initialize. This
was local validation orchestration, not scroll failure or production CI. The
clean repetition uses an already-built, untouched dist and no concurrent build.
The shared CI gate already builds and tests serially. No test is altered to
ignore missing modules.

The initial investigation was local-only at the user's request. The subsequent
approved scope is commit, push, a separate PR and hosted PR CI verification.
Merge and production deployment remain prohibited. Hosted results are recorded
in the PR after they complete; local verification is not represented as hosted
CI success. The production workflow itself is not dispatched for this PR.

Final scroll diagnostic repetition on the final source and unchanged build:
30/30 passed, ten per engine (Chromium 153 headless-shell, Chrome 155
new-headless, WebKit). Earlier held-transition + scroll repetitions passed 60/60.
The 117-case extended matrix remains reported as 112 passed / 5 pre-existing
WebKit paste failures; it is not represented as an entirely green suite.
