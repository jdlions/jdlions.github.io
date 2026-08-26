# The Lion's Pride website and editorial system

The repository hosts the public website of **The Lion's Pride**, Joongdong High School's English newspaper club, on GitHub Pages. Phase 1 adds a static, development-only editorial workspace without replacing the public website or publishing individual student articles.

> **Privacy warning:** this is a public repository. Never commit real student names, drafts, notes, account information, tokens, or photos. All Phase 1 people and editorial records are fictional fixtures.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Existing public site and Archive; remains usable without JavaScript because archive markup is retained as a fallback. |
| `/login/` | Clearly labeled mock role switcher for Public, Student, and Admin. |
| `/student/` | Guarded development My Page with the signed-in mock student's own articles and photo metadata workflow. |
| `/admin/` | Guarded development dashboard, Issue configuration, article editor, photo review, and publication preview. |

Directory routes use physical `index.html` files so they work on GitHub Pages without a rewrite fallback.

## Architecture

- **UI:** route HTML files plus `assets/css/editorial.css` and route controllers in `assets/js/student` and `assets/js/admin`.
- **Authentication:** `assets/js/auth` exposes an auth-service boundary and a Phase 1 `MockAuthService`. The mock session is in `sessionStorage` and is not security.
- **Service layer:** `assets/js/services/service-contracts.js` documents the replaceable contract. `MockEditorialService` implements it for local development.
- **Data/storage:** fictional seeds live only in `assets/js/data/mock-data.js`; mutable development state is copied into browser `localStorage`. The service, rather than UI components, owns reads and writes.
- **Public archive:** canonical committed records are in `data/issues.json`. `assets/js/public/archive.js` progressively renders them into the current Archive styles; the original embedded rows remain as a no-JavaScript/network-failure fallback.

There is intentionally no framework or build step. This limits disruption to the deployed public site and matches its existing static architecture.

## Phase 1 behavior

### Mock authentication

The login route switches among fictional Public, Student, and Admin sessions. Route guards improve development UX only. In production, the browser must receive a secure server session after the backend validates Google Identity and Classroom membership. A browser-supplied role must never be trusted.

### Student area

The fictional student can view only records filtered by the authenticated mock student ID, compare an immutable original with a separately stored edited version, inspect review status, and submit photo metadata. Selected image binaries are not persisted; the mock stores only filenames and metadata.

### Admin area

The admin dashboard derives counts from service data. Editors can:

- create and activate Issues;
- select any mock Classroom and manually map any two assignments using stable `courseId` and `courseWorkId` values;
- filter submissions by Issue, article type, student, and status;
- navigate student-first submissions and edit a separate version without changing `originalContent`;
- use basic rich-text commands, notes/visibility metadata, statuses, Previous, Save, and Save & Next;
- filter and review photo metadata without destructive deletion; and
- validate/preview one final `drive.google.com` URL in the existing Archive visual language.

Issue records use an extensible array:

```js
{
  id, name, year, season, status, classroomCourseId, createdAt,
  articleTypes: [{ id, label, courseWorkId }]
}
```

Assignments are never selected by title matching. Adding a future article type is a data/configuration change, not a schema rewrite.

## Failure states

Phase 1 provides visible states for missing login, wrong role redirects, no active Issue, no submissions, no matching filters, unavailable assignments/submissions, invalid publication URLs, and local upload/service errors. Production service errors should map backend error codes for unavailable Classroom/Google API, removed assignment, authorization denial, network failure, and failed Drive upload into the same visible notice/toast patterns.

## Local development and checks

Serve the repository over HTTP because ES modules and JSON fetches are restricted under `file://`:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173/`. Use **LOGIN** to enter either mock workspace. “Reset mock data” in Admin clears edits in the current browser and restores fixtures.

Run static checks:

```bash
python3 scripts/validate.py
```

## Production backend (Cloudflare Worker + Google)

The repository now contains a production backend in `worker/`. The deployed API base URL is:

```text
https://lions-pride-editorial-api.editor-936.workers.dev
```

The static UI remains in mock mode by default so the public site, Archive, and existing demonstration workspaces are unchanged. To test production mode, open any editorial route once with `?editorialMode=production`; use `?editorialMode=mock` to switch back. Production mode uses credentialed requests to the Worker and never accepts a browser-provided role, email, or student ID as authorization evidence.

### Worker environment

Non-secret variables (in `worker/wrangler.toml` or Cloudflare **Workers & Pages → lions-pride-editorial-api → Settings → Variables and Secrets**):

| Name | Value |
| --- | --- |
| `FRONTEND_ORIGIN` | `https://jdlions.github.io` |
| `OAUTH_REDIRECT_URI` | `https://lions-pride-editorial-api.editor-936.workers.dev/auth/callback` |
| `NEWSPAPER_CLASSROOM_ID` | The stable Google Classroom course ID selected for the newspaper club |
| `DRIVE_UPLOAD_FOLDER_ID` | The stable ID of a private, school-governed Drive upload folder |

Secrets (enter values only in Cloudflare; do not put them in source, `.env`, screenshots, issues, or PR comments):

```bash
cd worker
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

Generate `SESSION_SECRET` as a cryptographically random value of at least 32 bytes. The OAuth client secret is neither needed nor accepted by the frontend. For local development, copy `worker/.env.example` to the gitignored `worker/.dev.vars` and fill it only on the developer machine.

### D1 creation and deployment

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create editorial-production
```

Copy only the generated D1 `database_id` into the commented `[[d1_databases]]` block in `worker/wrangler.toml`, uncomment that block, then run:

```bash
npm run db:remote
npm run deploy
```

The binding name must remain `DB`. D1 stores Issue configuration, separate edited HTML, notes/status, and photo metadata. Student originals stay in Classroom/Docs and uploaded photo binaries stay in the private Drive folder. If `DB` is absent, private persistence endpoints fail closed with `database_unconfigured`; the browser mock remains available and does not silently become production storage.

### Google Cloud configuration

Use the school-owned Google Cloud project **The Lions Pride Editorial**. Google Classroom API, Drive API, and Docs API must remain enabled. In Google Auth Platform:

1. Keep Audience **Internal** for the school Workspace organization.
2. Keep Authorized JavaScript origin `https://jdlions.github.io`.
3. Set the exact redirect URI `https://lions-pride-editorial-api.editor-936.workers.dev/auth/callback` (including path and HTTPS).
4. Review/approve the least-privilege scopes listed in `worker/src/index.js`. Workspace admin policy may require marking the OAuth app trusted because Classroom roster/submission scopes can be restricted.
5. Ensure the signing-in teacher/student can access the configured Classroom and its attachments. Create a private Drive folder governed by the school and supply its folder ID as `DRIVE_UPLOAD_FOLDER_ID`; do not make it public.

The server uses Authorization Code + PKCE, validates encrypted `state`, and exchanges the code with the client secret only inside the Worker. After sign-in, it checks the configured Classroom: teachers become `admin`, students become `student`, and non-members are denied. Session and OAuth state cookies are `Secure`, `HttpOnly`, and `SameSite=None`; mutating requests additionally require the exact frontend Origin plus a custom CSRF header. CORS allows only `FRONTEND_ORIGIN` and credentials.

### API contract

- `GET /api/session`
- `GET|POST /api/issues`; `PATCH /api/issues/:id/activate`
- `GET /api/classroom/courses`
- `GET /api/classroom/:courseId/coursework`
- `GET /api/articles?issueId=…`
- `GET /api/articles/:id?issueId=…`
- `PATCH /api/articles/:id/edit`
- `GET /api/photos?issueId=…`
- `POST /api/photos/upload`; `PATCH /api/photos/:id/status`

Issue mappings always contain explicit `classroomCourseId` and `articleTypes[].courseWorkId`. Assignment names are display data, never selection logic. Article and photo access is re-scoped from the server-authenticated Classroom identity; student identifiers in request bodies are not trusted.

### Untrusted content and XSS

Google Docs text, attachment titles, filenames, captions, notes, URLs, and edited HTML are untrusted. Docs are converted to escaped text paragraphs. Edited HTML is normalized server-side through a deliberately small element allow-list that removes active/embedded content, event handlers, and dangerous URL schemes. The existing UI also escapes text metadata. Before broad production use, replace the lightweight Worker sanitizer with a maintained, parser-based HTML sanitizer compatible with Workers, add a strict Content Security Policy to editorial pages, and keep sanitized output separate from immutable originals. Never render raw Google/Drive metadata with `innerHTML`.

## Google Cloud Setup — Required Before Production

No credentials or real Google calls are included. Before production:

1. Create/review a Google Cloud project under school governance and configure an OAuth consent screen.
2. Configure an approved web OAuth client with exact production redirect origins. Keep the client secret in backend secret storage, never this repository.
3. Enable and review:
   - **Google Identity / OAuth:** authenticate the Google account; backend validates ID/access tokens and creates a secure session.
   - **Google Classroom API:** verify membership/teacher role, list courses and all course work, roster students, and retrieve student submissions and attachments.
   - **Google Drive API:** access attached Docs as permitted and upload student photos into a restricted newspaper folder; persist Drive file IDs/URLs, not binaries in GitHub.
   - **Google Docs API:** read document structure/content from attached Google Docs without modifying the student's original.
4. Implement a private backend (a Cloudflare Worker is one option) for token verification, server-side Classroom authorization on every request, secure cookies/session rotation, data access, uploads, edit persistence, and authenticated publication.
5. Choose private storage (for example, D1, Firestore, or Supabase after governance/cost review) with access control, retention, audit, backup, and deletion policies.
6. Replace the mock service factories without coupling UI controllers to Google SDKs.

### Proposed scopes for review—not finalized

Apply least privilege and validate exact requirements in a test tenant before consent review. Likely starting points include OpenID Connect identity scopes (`openid`, `email`, `profile`), read-only Classroom courses/coursework/rosters/submissions scopes, read-only Drive/Docs access where attachment retrieval requires it, and a narrowly constrained Drive file scope for app-created uploads. Avoid broad full-Drive access. Teacher and student flows may require different incremental scopes. Do not deploy scopes until the school's administrator and privacy owner approve them.

## Production security requirements

- Authorize every private API operation server-side from a validated session and current Classroom membership; never from URL parameters, local storage, or a role sent by JavaScript.
- Scope student reads by the server-derived Google subject/student identity. Admin endpoints must independently verify teacher membership.
- Use secure, HTTP-only, SameSite cookies; short sessions; CSRF defenses; strict origin/CORS rules; rate limits; and safe upload size/type/content validation.
- Encrypt private data in transit and at rest, minimize collection, define retention/deletion, and avoid logging drafts, tokens, or personal information.
- Keep the original Classroom/Docs attachment immutable. Store edited content separately with actor/time metadata and, later, revision history.
- Restrict the Drive upload folder and final PDF permissions deliberately. Do not make working photos or drafts link-public.
- Treat filenames, captions, rich text, URLs, and imported Docs as untrusted input. Sanitize on the backend and again for its rendering context.

## Verification and current limitations

Run repository and Worker checks:

```bash
python3 scripts/validate.py
cd worker
npm install
npm run check
npm run dev
```

Local OAuth requires a separate localhost OAuth client/redirect or a deployed Worker; do not add localhost redirect values to the production client casually. Automated checks cover syntax, repository structure, archive regression markers, security helpers, ignored secret files, and the absence of obvious credentials. Live OAuth, Classroom membership, Docs attachment reads, Drive upload, D1 persistence, and cross-site cookies require the real school Workspace accounts and Cloudflare bindings and therefore must be verified after deployment.

Recommended live test order: deploy/bind D1 → set variables/secrets → confirm `/` health response → test a non-member denial → teacher login/admin course list → explicit Issue mappings → student login/own submissions only → read-only Docs original → admin separate edit/status → JPEG/PNG/WebP upload into private Drive → student/admin photo visibility → logout and expired-session behavior → switch back to mock and recheck public Archive/student/admin routes.

## Phase 1 limitations

Mock mode remains browser-local. Production mode provides server authorization, Google reads/uploads, and D1-backed editorial state, but final public Archive publication remains intentionally separate: the mock Publish button cannot modify GitHub. A protected review/commit workflow is still required before publishing. The current production client is deliberately minimal and should receive usability/error-state hardening after the first credentialed integration test.
