import { json } from '../lib/utils.mjs';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  let githubAuth = false;
  let githubLogin = '';
  let githubError = '';
  const ghToken = process.env.GITHUB_TOKEN || '';

  if (ghToken) {
    try {
      const r = await fetch('https://api.github.com/user', {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': 'Bearer ' + ghToken,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      const body = await r.json().catch(() => ({}));
      githubAuth = r.ok;
      githubLogin = r.ok ? String(body.login || '') : '';
      githubError = r.ok ? '' : String(body.message || ('HTTP ' + r.status));
    } catch (e) {
      githubError = String(e.message || e);
    }
  }

  return json(res, 200, {
    ok: true,
    version: '9.1',
    service: 'AI HQ Production Gateway',
    sessionAuth: !!process.env.AIHQ_SESSION_TOKEN,
    jobSigning: !!process.env.AIHQ_JOB_SECRET,
    ownerConfigured: !!process.env.GITHUB_OWNER,
    githubOwner: process.env.GITHUB_OWNER || '',
    githubAuth,
    githubLogin,
    githubError,
    providers: {
      github: !!ghToken,
      vercel: !!process.env.VERCEL_TOKEN
    }
  });
}
