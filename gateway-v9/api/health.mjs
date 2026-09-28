import { json } from '../lib/utils.mjs';

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  return json(res, 200, {
    ok: true,
    version: '9.0',
    service: 'AI HQ Production Gateway',
    providers: {
      github: !!process.env.GITHUB_TOKEN,
      vercel: !!process.env.VERCEL_TOKEN
    }
  });
}
