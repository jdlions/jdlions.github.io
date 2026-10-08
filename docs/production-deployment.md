# Merge-triggered PrideDesk production release

Baseline: `4e8ebb9d75f69b35175e2d953191557a00c241aa` (PR #46).

## One-time setup before merging this workflow

Repository Settings → Secrets and variables → Actions → Repository secrets:

| Secret | Minimum use |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Existing account: Workers Scripts Edit, D1 Edit, and account read needed by Wrangler. Restrict to the production account. No OAuth/Drive secrets here. |
| `CLOUDFLARE_ACCOUNT_ID` | Account containing `lions-pride-editorial-api` and `editorial-production`. |
| `VERCEL_TOKEN` | Token authorized to read and create deployments in the existing PrideDesk project/team. |
| `VERCEL_PROJECT_ID` | Existing project's ID from Vercel Project Settings → General. Must point to root directory `pridedesk`, linked to `jdlions/jdlions.github.io`. |
| `VERCEL_TEAM_ID` | Team ID when this project belongs to a team; omit for a personal project. |

The built-in `github.token` is used only to read the current main ref. Existing
secrets with these names are reused. This implementation does not create, reveal,
rotate or copy any secret. The current connector cannot list Actions secret names;
their presence must be checked once in Settings. No deployment Environment with
required reviewers is used, so correctly configured merges need no manual approval.

Vercel keeps Git integration and branch previews. `pridedesk/vercel.json` disables
**main's automatic Git deployment only**, so it cannot race ahead of D1/Worker.
The Action creates an exact-SHA production deployment using the existing project
and its settings/environment. Do not add another production deploy hook/Workflow.
Do not disconnect the Git repository. If an existing project-level ignored build
command blocks API deployments, remove that conflicting rule before first use.
Keep Vercel's system environment variables exposed to builds (the normal default),
so `VERCEL_GIT_COMMIT_SHA` can be written to the release verification file.

## Flow and retry

`push main` (including merge) → existing Worker/frontend/browser/build/validate
checks + release-script mock tests → preflight → read D1 migration ledger → safe
pending migrations → re-read ledger → Worker exact commit, 100% traffic → Vercel
same SHA READY and alias assigned → verify production alias/commit → read-only smoke.

`concurrency: pridedesk-production`, `cancel-in-progress: false` serializes all
production runs. Before every deployment operation, the run checks the current
main ref. An obsolete queued run fails visibly without deploying an older commit.
On retry (`workflow_dispatch` on main or rerun), an existing matching Worker
100% release is reused; a matching READY/building Vercel deployment is reused.
An uncertain provider request is not blindly retried as a POST. An operator can
rerun after inspection; the script discovers existing deployments first.

Worker versions carry `git-<40-character SHA>` tags. The API is queried for the
active version/deployment and traffic, not inferred from a successful CLI exit.
Vercel must report the actual `gitSource.sha`/`githubCommitSha`; our own metadata
label is not accepted as proof. `deployment.json` contains only build SHA and asset
prefix, has the global `private, no-store` policy, and is checked at the public
production domain. The alias must resolve to the exact verified deployment.

## D1 safety

Only database `editorial-production` / `ad7878f5-4347-441d-835e-37254299dfda` is
allowed. A pending file needs both an exact reviewed SHA256 in
`scripts/approved-migrations.json` and a conservative additive SQL check.
Only nullable ADD COLUMN and empty CREATE TABLE are eligible. DML/backfills,
deletions, renames, triggers, constraints on existing rows and other unrecognized
SQL stop the release **before migration or Worker deploy**, even if listed.
Risky changes require a separately reviewed manual migration and operational plan;
they are not made safe by adding a filename to the manifest.

Only PR #46's unchanged `0008_assignment_lengths.sql` is approved: new nullable
limits leave all existing campaigns unlimited; the audit table starts empty.
Older missing migrations or unknown ledger entries require investigation.
Wrangler applies only pending migrations; re-reading the ledger confirms completion.
Migration failure stops Worker; Worker failure stops Vercel. No automatic D1
rollback, bulk return, article submission or data repair is performed.

## Results and limitations

Every release stage logs running/success/failure. The Action is failed on any
exception, mismatch, timeout or smoke failure. A 45-minute job limit and request/
provider wait deadlines prevent indefinite loading. `deployment-result.json`
and the Actions Summary retain commit, completed Worker/Vercel IDs and stage
results without provider bodies or credentials. Failed tests appear in the same
workflow before deployment. No success is claimed for an unverified release.

Smoke checks anonymous session, 401 on protected APIs, public archive (including
No.34 and at least 18 issues), login/admin/student HTML noindex, no-store and
public static cache, exact build commit. No authenticated student data is read.
It cannot prove authenticated writing/editing; those flows are covered by isolated
Worker/browser tests and require an authorized manual login if operationally needed.
Smoke failure after a deploy means investigation is required; it does not undo
data or secretly roll back releases. The recorded Worker version is available for
an explicitly authorized rollback, with schema compatibility considered first.

## Baseline production observation (read-only, 2026-10-08)

PR #46 is merged at the baseline SHA. The production D1 ledger contains only
0001–0007: **0008 is not applied**. Active Worker is
`291145a7-284b-4106-ac27-b2b6bae9448e`, deployment
`62376ff8-f84d-49ce-b458-5fbe15abd3d6`, 100%, annotated PR #43.
GitHub has a Vercel Production deployment record for PR #46; the live admin JS
contains `lengthFields` and `downloadQueuePng`. Therefore its new backend-dependent
controls are not ready on the old Worker. Existing production was not changed.
After setup and approval, the first main merge can apply reviewed 0008 and deploy
the then-current complete main in sequence; otherwise apply 0008 → Worker → verify
frontend through a separately authorized manual operation.

## Verification of this PR

Baseline suites: Worker 241 / frontend 5 / Chrome 133; selected existing Edge
editor and assignment/PNG coverage 38. This PR: Worker 241 / frontend 6 /
release scripts 19 / Chrome 133 / Edge 38, all passed (437 checks including Edge).
The release adapter is exercised with mock Cloudflare/Vercel responses, including
pending 0008, provider delay/failure, mismatch, replay and stale-main rejection.
Actual production execution was intentionally not attempted. `actionlint` validates
both workflows; build, validate and diff checks pass. No dependency was added.

References: [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration),
[deployment REST API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment),
[Cloudflare versions](https://developers.cloudflare.com/workers/versions-and-deployments/),
[D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/).
