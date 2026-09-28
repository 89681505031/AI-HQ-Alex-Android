import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 8787);
const expectedToken = process.env.AIHQ_SESSION_TOKEN || '';
const jobs = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function auth(req) {
  if (!expectedToken) return true;
  return req.headers.authorization === 'Bearer ' + expectedToken;
}

async function body(req) {
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const raw = Buffer.concat(parts).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function simulate(job) {
  const steps = [
    [15, 'running'],
    [45, 'running'],
    [80, 'running'],
    [100, 'success']
  ];
  let i = 0;
  const timer = setInterval(() => {
    const current = jobs.get(job.id);
    if (!current || current.status === 'cancelled') return clearInterval(timer);
    const [progress, status] = steps[i++];
    current.progress = progress;
    current.status = status;
    current.updatedAt = new Date().toISOString();
    if (status === 'success') {
      current.result = { ok: true, mode: 'reference-server', type: current.type };
      if (current.type === 'apk.build') {
        current.artifacts = [{ name: 'debug.apk', url: '' }];
      }
      clearInterval(timer);
    }
  }, 700);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.url === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, version: '1', worker: 'AI HQ reference gateway' });
  }
  if (!auth(req)) return json(res, 401, { error: 'Unauthorized' });

  if (req.url === '/jobs' && req.method === 'POST') {
    try {
      const input = await body(req);
      const id = randomUUID();
      const job = {
        id,
        clientJobId: input.clientJobId || '',
        type: input.type || 'unknown',
        projectId: input.projectId || '',
        missionId: input.missionId || '',
        payload: input.payload || {},
        status: 'queued',
        progress: 0,
        result: null,
        error: '',
        artifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      jobs.set(id, job);
      simulate(job);
      return json(res, 202, job);
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) });
    }
  }

  const match = req.url?.match(/^\/jobs\/([^/?]+)$/);
  if (match && req.method === 'GET') {
    const job = jobs.get(decodeURIComponent(match[1]));
    return job ? json(res, 200, job) : json(res, 404, { error: 'Job not found' });
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`AI HQ reference gateway listening on :${port}`);
});
