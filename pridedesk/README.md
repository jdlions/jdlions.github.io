# PrideDesk Vercel frontend

This directory builds only login/admin/student and their production assets. The
public newspaper stays on GitHub Pages. Shared UI source remains in the existing
root folders; `build.mjs` changes internal `/editorial/` navigation to `/` in the
Vercel output only. Both builds share `scripts/editorial-files.mjs`.

## Routing and authentication

| Browser request | Vercel external rewrite destination |
| --- | --- |
| `/api/:path*` | existing Worker `/pridedesk/api/:path*` |
| `/auth/:path*` | existing Worker `/pridedesk/auth/:path*` |
| `/login/`, `/admin/`, `/student/` | Vercel static frontend |

The Worker normalizes only the `/pridedesk/` namespace against the exact
`PRIDEDESK_ORIGIN` setting. It does not trust forwarded host headers. The request
body, method, query and headers survive normalization. Existing CSRF logic still
requires an exact Origin match plus `X-Editorial-CSRF: 1` on writes. There are no
new CORS permissions, wildcard origins, client tokens or serverless upload limits.
The external rewrite proxies uploads and authenticated Drive image streams.

Google uses the frontend `/auth/callback`, which rewrites back to the Worker.
OAuth state is sealed with its origin and PKCE verifier; callback redirects use
the configured origin and server-resolved role, never `returnTo` or forwarded
headers. Both `Set-Cookie` headers must reach the browser unchanged. Cookies stay
host-only `__Host-`, Secure, HttpOnly, SameSite=Lax, Path=/; no Domain attribute.
API/auth responses and the Vercel deployment disable CDN caching.

The original `/api`, `/auth` and `/editorial` Worker routes keep their existing
origin and behavior. D1, Classroom, Drive, Docs and credentials remain in
Cloudflare. Existing Worker cookies are not transferred to Vercel; sign in again.

## Connect the new Vercel project

Do not change the Pages branch or attach the public newspaper domain to Vercel.
Import `jdlions/jdlions.github.io` as a **new** project with:

| Setting | Value |
| --- | --- |
| Branch to deploy | `feature/pridedesk-vercel` |
| Root Directory | `pridedesk` |
| Include source files outside Root Directory in Build Step | **Enabled** (shared source is in the parent directory) |
| Framework preset | Other |
| Node.js | 24.x |
| Build command | `npm run build` |
| Output Directory | `dist` |
| Environment variables | None; no Google/Cloudflare secrets on Vercel |

Use a stable domain for this project, for example `https://pridedesk.vercel.app`
**only if Vercel actually assigns that name**. Below, `DESK_ORIGIN` means that
exact assigned HTTPS origin, with no path or trailing slash. Select the feature
branch for this new project's deployment before deploying; do not deploy `main`
as its PrideDesk source. Do not enable an automatic Worker deployment workflow.

## Required Cloudflare / Google values

This commit does not deploy a Worker, run migrations or modify a console. The
current Worker must receive the new code before the new proxy routes can work.
Without that code the old catch-all can return a service-status JSON with HTTP
200, which is **not** proof that the proxy is ready.

For a later authorized release, deploy this branch's Worker code and set one
additional Worker variable:

```text
PRIDEDESK_ORIGIN=DESK_ORIGIN
```

Keep `EDITORIAL_ORIGIN`, `OAUTH_REDIRECT_URI`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `NEWSPAPER_CLASSROOM_ID`,
`DRIVE_UPLOAD_FOLDER_ID` and the D1 binding unchanged. No migration is needed.
Preserve `PRIDEDESK_ORIGIN` in future deployment configuration (Wrangler CLI
variables or the managed vars configuration); do not let an existing Wrangler
vars table overwrite a console-only setting.

Example release command, **not executed by this change**, from `worker/`:

```sh
npm run build:static
npx wrangler deploy --var PRIDEDESK_ORIGIN:https://YOUR-ASSIGNED-DOMAIN
```

In the existing Google OAuth web client, append this **Authorized redirect URI**:

```text
DESK_ORIGIN/auth/callback
```

Keep the existing Worker callback URI. Do not register the internal
`/pridedesk/auth/callback` Worker path. This server-side redirect flow does not
use Google Identity JavaScript, so no additional Authorized JavaScript origin
is required. No new scopes, API keys or Classroom/Drive/Docs permissions are
needed. Use a fixed origin; random Vercel preview domains are not authorized and
must not be added through a wildcard. For authenticated preview testing use an
isolated Worker configuration and a separately registered fixed preview origin.

## Verification

From the repository root:

```sh
npm ci --prefix worker
npm run check --prefix worker
npm test --prefix pridedesk
python scripts/validate.py
```

Tests cover both roles' OAuth login/callback/session flow with mocked Google,
state-origin binding, two cookies, legacy login, CSRF rejection, untrusted
forwarding headers, multipart body preservation, build dependencies and route
configuration. They do not impersonate real Google users or validate Vercel's
live network behavior.

After the authorized deployment, verify in a browser on the fixed domain:

1. `/`, `/login`, `/admin`, `/student` resolve to their slash-terminated pages
   with all scripts/CSS loaded. Public links open GitHub Pages.
2. `/api/session` before login is exactly an unauthenticated session response,
   not generic service-status JSON. Responses are not CDN cache hits.
3. Google login creates the frontend state cookie. The Google redirect URI is
   `DESK_ORIGIN/auth/callback`. Callback sets session and clears state separately.
4. Test a teacher and student: redirects stay on `/admin/` or `/student/` on the
   Vercel origin. API/image URLs remain same-origin. No cookies target workers.dev.
5. Save a draft, upload a photo within the existing 15 MB limit, view the private
   image and log out. Confirm multipart bodies and private response headers pass
   through Vercel, and session reload is unauthenticated after logout.
6. Requests without the CSRF header or with another Origin return 403. Confirm
   original Worker login and the public homepage still work.

To disable only the new entry point, remove `PRIDEDESK_ORIGIN`; the namespace
fails closed with 503. Leave the original Worker origin/callback untouched.

References: [Vercel external rewrites](https://vercel.com/docs/routing/rewrites),
[root-directory shared source](https://vercel.com/docs/monorepos/monorepo-faq),
[routing configuration](https://vercel.com/docs/project-configuration/vercel-json).
