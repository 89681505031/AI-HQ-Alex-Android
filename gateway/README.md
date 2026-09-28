# AI HQ V8 Execution Gateway

This folder defines the external worker contract used by the Android app.

## Required endpoints

- `GET /health` → `{"ok":true,"version":"1"}`
- `POST /jobs` → accepts `clientJobId`, `type`, `projectId`, `missionId`, `payload`; returns a job id and status.
- `GET /jobs/:id` → returns `status`, `progress`, optional `result`, `error`, and `artifacts`.

Supported job types:
`github.create_repo`, `github.commit`, `test.run`, `apk.build`, `vercel.deploy`, `release.publish`.

## Security

Do not embed GitHub/Vercel/API secrets in the APK. Keep provider credentials on the server. The app may send a short-lived bearer token stored only in sessionStorage.

The included reference server is intentionally a local/demo implementation. It proves the protocol but does not expose provider credentials or publish real releases. Production deployment should replace the simulated handlers with authenticated GitHub/Vercel workers and persistent job storage.
