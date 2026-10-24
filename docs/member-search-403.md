# Preview directory-search 403 diagnosis

HTTP 403 / PERMISSION_DENIED alone does **not** establish a Workspace policy denial.
The real response's finer reason was previously discarded. Do not claim a cause
from mock tests, Gmail behavior, an enabled consent-screen scope, or no new consent dialog.

## Evidence available without exporting credentials

- Actual endpoint: `GET https://people.googleapis.com/v1/people:searchDirectoryPeople`.
- Parameters: query supplied by administrator, `readMask=names,emailAddresses,photos`,
  `sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`, `pageSize=10`. These match the
  [official method](https://developers.google.com/people/api/rest/v1/people/searchDirectoryPeople).
- Callback stores `searchSource=directory` in the sealed session **only** when the
  token exchange response's scope contains `https://www.googleapis.com/auth/directory.readonly`.
  Search rejects a session without this marker before calling Google. Therefore an
  upstream directory-search error proves exchange-time grant verification, not a
  live token introspection or exemption from later administrator restrictions.
- Safe error diagnostics retain only allowlisted status/reasons, known detail type
  names, the exact People service identifier, and that exchange-time verification.
  Provider messages, arbitrary detail metadata, consumer/project values, request
  query, token, cookie and contact results are neither returned nor logged.
- `NOT_PROVIDED` means no allowlisted reason was available; it is not proof of any
  particular configuration error. Unknown detail types/reasons are intentionally omitted.

## Retry without new OAuth consent

After the PR's CI passes, deploy the same commit to the existing **Preview Worker
only**, with `wrangler.preview.toml --keep-vars`. Preserve SESSION_SECRET and all
existing Google variables. No database change is required.

In the existing browser/session open the fixed branch Preview, Members → Register
→ School directory, and search again. Report only HTTP/status, reason and detail
type labels shown. Do not save a member or send a cookie, token, callback URL,
contact list or network capture. A new login/consent is not requested by this patch.

## Interpret the real reason before requesting configuration changes

- `SERVICE_DISABLED` / `accessNotConfigured`: in Google Cloud Console select the
  project that **owns the OAuth client used by the Preview Worker**, then APIs &
  Services → Enabled APIs & services → Google People API. An enabled API in a
  different project, or adding a scope on the consent screen, does not enable it
  for this client. URL: https://console.cloud.google.com/apis/library/people.googleapis.com
- `ACCESS_TOKEN_SCOPE_INSUFFICIENT` / `insufficientPermissions`: investigate the
  granted token scopes and source mismatch. Compare the exchange-time verification;
  do not repeatedly request consent as a substitute for diagnosis.
- `ORG_RESTRICTION_VIOLATION`, `SECURITY_POLICY_VIOLATED`, `domainPolicy`: ask the
  school's Workspace administrator to check https://admin.google.com/ → Security →
  Access and data control → API controls → Manage App Access. Find the **existing
  OAuth client ID** (Google Cloud → Google Auth Platform → Clients), select its
  existing entry or Configure new app → OAuth app name/client ID, and inspect the
  organizational unit/group containing the test administrator. If approved by the
  school, choose Specific Google data and permit `directory.readonly` alongside
  currently needed sign-in scopes; preserve existing app permissions. Do not
  broadly mark all data Trusted, change domain-wide delegation, or change school
  policy without approval. A PrideDesk teacher is not necessarily a Workspace
  security administrator. [Official app-access instructions](https://support.google.com/a/answer/7281227?hl=en&p=app_access_apps).
- Generic `forbidden` or `NOT_PROVIDED`: insufficient evidence to distinguish these
  causes. Have the Workspace administrator inspect existing policy and Directory →
  Directory settings → Sharing settings → Contact sharing and visibility for that
  user. Inspect first, do not enable organization-wide sharing merely to test.
  [Official Directory instructions](https://knowledge.workspace.google.com/admin/users/turn-directory-on-or-off).

No Google Cloud/Workspace setting is changed by this patch. No production deploy,
production database access, new scopes or migrations are part of this diagnosis.
