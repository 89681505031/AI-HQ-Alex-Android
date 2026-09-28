import { authorized, json, cors, decodeTicket } from '../lib/utils.mjs';
import { pollGithubActions, pollVercel } from '../lib/providers.mjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const raw = req.query?.id || new URL(req.url, 'http://local').searchParams.get('id') || '';
    const ticket = decodeTicket(raw);
    let out;
    if (ticket.provider === 'github-actions') out = await pollGithubActions(ticket);
    else if (ticket.provider === 'vercel') out = await pollVercel(ticket);
    else return json(res, 400, { error: 'Unknown provider ticket' });
    return json(res, 200, out);
  } catch (e) {
    return json(res, 400, { error: String(e.message || e) });
  }
}
