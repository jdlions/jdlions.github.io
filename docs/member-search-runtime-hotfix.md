# Preview People search 500

## Root cause and evidence

The user completed Preview login and directory consent, then observed `Unexpected server error` from the member search UI. At HEAD `0fc5d8a`, `member-search.js` passed `redirect: 'error'` to `fetchWithTimeout`. Its call to runtime `fetch(url, init)` throws while constructing the request on workerd. The outer Worker catch maps that unclassified TypeError to HTTP 500 / `internal_error`.

The new isolated Miniflare/workerd test executes the actual search module and timeout helper. Before the fix it fails with:

`Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).`

This is a Worker exception **before outbound Google HTTP**. A Google HTTP status/error code is therefore not available for this reproduced failure. It is not evidence of missing consent or Workspace denial. No user token/cookie, live contact results, production API, or production D1 is used in reproduction. No historical live stack trace is claimed: the existing outer catch records code/status only. The exception above comes from the actual isolated Workers runtime.

Node tests replaced global fetch with a mock and did not enforce workerd's redirect enum, repeating the runtime mismatch previously fixed for Drive in PR 54. The existing People tests were insufficient; the new runtime regression closes that gap.

## Minimal repair

- Use `redirect: 'manual'`. Existing non-success checks reject 3xx without following Location or forwarding the bearer token.
- Differentiate transport (502), timeout (504), Google HTTP failures, and malformed JSON (502).
- Google failure diagnostics contain HTTP status and a fixed allowlist of Google status codes only. Never log query, name/email, provider message/body, headers, cookies, or token. The API exposes a safe error message with HTTP/code for diagnosis.
- Keep OAuth scopes, state/nonce/PKCE, existing Preview sessions, database bindings, and normal member flows unchanged. No new login/consent is required by this code change.
- The workerd regression verifies successful filtering, 302 blocking without another-origin calls, and safe 403/500 handling. All Google responses in it are synthetic.

## Deployment and retry

Update existing PR 59 and deploy the identical commit to **`lions-pride-editorial-api-preview` only**, using `worker/wrangler.preview.toml` and `--keep-vars`. Do not rotate SESSION_SECRET, overwrite Google settings, touch production, or run migrations.

After CI passes and Preview Worker is updated, use the fixed Preview in the same browser/session. Refresh, open Members → Register, type the same name again, and select a result if present. Do not save. Additional Google login/consent is not the first diagnostic step. If a different Google error remains, report only HTTP/status code shown; do not copy contact lists, cookies, token or full callback URL. Real search success remains unverified until the user confirms it; mock/workerd success alone is not live Google validation.
