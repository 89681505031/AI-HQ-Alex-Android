# AI HQ V9 Production Gateway

This directory is a deploy-ready Vercel backend for AI HQ.

## What it can do

- create a GitHub repository;
- write project files to GitHub;
- install an AI HQ worker workflow in the target repository;
- dispatch GitHub Actions tests;
- dispatch Android APK builds;
- create Vercel deployments through the server-side Vercel API;
- create a GitHub Release after director approval;
- poll long-running provider jobs using signed stateless tickets.

## Important security rule

Provider credentials must never be placed in the APK or committed to GitHub.

Configure these as **Vercel project environment variables**:

- `AIHQ_SESSION_TOKEN` — short secret used by the Android app to authenticate to the gateway.
- `AIHQ_JOB_SECRET` — separate random secret used to sign job tickets.
- `GITHUB_TOKEN` — server-side GitHub token with only the repository/actions permissions you intend to grant.
- `GITHUB_OWNER` — GitHub username or organization where AI HQ may create projects.
- `VERCEL_TOKEN` — server-side Vercel token used only when AI HQ is allowed to deploy sites.
- `VERCEL_TEAM_ID` — optional Vercel team id.
- `VERCEL_PROJECT_ID` — optional default target Vercel project for website deployment.
- `VERCEL_PROJECT_NAME` — optional target project name.

Do not paste these values into chat or source code.

## Deploying the gateway itself

Create a separate Vercel project whose Root Directory is `gateway-v9`.

For the GitHub Actions workflow `.github/workflows/deploy-gateway.yml`, set repository secrets:

- `GATEWAY_VERCEL_TOKEN`
- `GATEWAY_VERCEL_ORG_ID`
- `GATEWAY_VERCEL_PROJECT_ID`

Those three secrets deploy the gateway itself. They are deliberately named differently from the runtime Vercel provider variables above.

Then run **Actions → Deploy V9 Gateway → Run workflow**.

## Android setup

In AI HQ V9 → Production:

1. enter the gateway URL, for example `https://your-gateway.vercel.app`;
2. enter the value corresponding to `AIHQ_SESSION_TOKEN`;
3. tap **Проверить сервер**;
4. open a mission and tap **Production pipeline V9**;
5. run the pipeline;
6. publication stops for director approval before `release.publish`.

The session token is stored only in browser/session storage and is not written to the APK source.
