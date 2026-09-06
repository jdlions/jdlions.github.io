# User workflow fixes

Based on main `7f516d3` (merged origin fix PR #24).

## Causes and changes

- Dropdowns already used absolute positioning, but lived inside glass panels with overflow clipping, isolation and backdrop filters. Focusing an offscreen option could scroll the clipped ancestor. Open listboxes now move to a fixed body overlay, fit the available viewport above/below the trigger and focus without scrolling. Escape, arrows, outside click and selected values remain supported.
- Queue IDs could exceed fixed grid tracks with no wrapping; narrow layouts hid the metadata. Tracks now allow shrinking and long IDs wrap; on narrow screens the ID and date occupy separate rows.
- Opening a review from Articles after visiting Dashboard left dashboard rows in hidden DOM. The global `[data-status]` lookup matched a queue row, whose `closest('[data-custom-select]')` was null. This threw before save/apply handlers were installed. The review input now has a dedicated selector scoped to the workspace, and navigation removes stale view contents. PATCH editor/status routes, payloads and CSRF contract were checked against the Worker and remain unchanged. Save failure is visible and pending autosave is cleared for explicit saves/navigation.
- Photo submission had no in-flight guard. The form now disables its controls, shows upload progress and restores controls in `finally`, preserving input on failure. The service also blocks concurrent batches and remembers confirmed File objects for partial-batch retry. Confirmed photos enter the gallery immediately.
- Views were rendered without pushState/popstate. Role pages now retain view/article hash routes, restore them on back/forward and reload, and flush editor saves before internal navigation. A restored login page revalidates the server session on persisted pageshow and redirects to the correct role. OAuth/cookies and role authorization are unchanged.

Server-side upload idempotency was considered but is not claimed: durable deduplication across browser reloads or ambiguous network failures requires a request record plus coordination with Drive/D1. A process-local Worker lock would not be reliable across isolates. This change does not modify Worker handlers, database schema or Google integration.

## Checks

From the repository root:

```sh
npm ci --prefix worker
npm run check --prefix worker
npm test --prefix pridedesk
cd worker
npx playwright install --with-deps chromium
cd ..
npm run test:browser --prefix worker
python3 scripts/validate.py
git diff --check
```

For an installed Chrome, set `PLAYWRIGHT_CHANNEL=chrome` instead of downloading Chromium. Browser tests use the real built frontend and mocked API responses; they do not authenticate real Google users or write production articles/photos. Existing Worker OAuth, CSRF, proxy and authorization tests continue to run. Browser checks are also included in the PR workflow.

## Release

1. Merge the PR into main. In the existing Vercel project for **https://pridesk.vercel.app**, verify Production Branch is **main**, Root Directory is `pridedesk`, and outside-root source files are included. If Git auto-deployment is enabled on main, merge triggers deployment; otherwise deploy the merged main commit from Vercel. The older setup README's feature-branch instruction describes the original rollout and is not evidence of the current project setting.
2. **No API Worker redeployment is required for the Vercel fixes.** The frontend bundles the changed JS/CSS locally; Worker routes and configuration did not change. To also update the legacy `/editorial/` UI served directly by workers.dev, run the existing `npm run deploy` from `worker/`, which rebuilds its static assets. No migration, secret, OAuth URI or origin setting change is needed.
3. After deployment, sign in with an admin and student on the production domain and smoke-test the five reported flows. Real Google/Drive/Classroom and production Vercel configuration were not accessed by these automated tests.
