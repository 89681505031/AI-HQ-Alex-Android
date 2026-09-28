import { authorized, json, readBody, cors } from '../lib/utils.mjs';
import { createRepo, commitFiles, dispatchWorkflow, deployVercel, publishRelease } from '../lib/providers.mjs';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const input = await readBody(req);
    const type = String(input.type || '');
    const payload = input.payload || {};
    let out;
    if (type === 'github.create_repo') out = await createRepo(payload);
    else if (type === 'github.commit') out = await commitFiles(payload);
    else if (type === 'test.run') out = await dispatchWorkflow(payload, 'test');
    else if (type === 'apk.build') out = await dispatchWorkflow(payload, 'apk');
    else if (type === 'vercel.deploy') out = await deployVercel(payload);
    else if (type === 'release.publish') out = await publishRelease(payload);
    else return json(res, 400, { error: 'Unsupported job type: ' + type });

    return json(res, out.status === 'success' ? 200 : 202, {
      id: out.id || input.clientJobId || '',
      status: out.status || 'success',
      progress: out.progress ?? (out.status === 'success' ? 100 : 10),
      result: out.result || null,
      artifacts: out.artifacts || []
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
}
