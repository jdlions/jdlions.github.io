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

## Phase 1 limitations

Authentication and all data are browser-local mocks; there is no cross-device persistence, true access control, Google integration, binary upload, collaboration, or backend publication. Rich-text commands use browser editing primitives intended for a lightweight prototype. The public JSON Archive is committed data; the mock Publish button cannot change repository files. Production publication needs a protected backend or an approved review/commit workflow.
