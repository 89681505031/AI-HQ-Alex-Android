import crypto from 'node:crypto';

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

export function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function authorized(req) {
  const token = process.env.AIHQ_SESSION_TOKEN || '';
  if (!token) return false;
  return req.headers.authorization === 'Bearer ' + token;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  const raw = Buffer.concat(parts).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function secret() {
  return process.env.AIHQ_JOB_SECRET || process.env.AIHQ_SESSION_TOKEN || 'dev-only-secret';
}

export function encodeTicket(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(data).digest('base64url');
  return data + '.' + sig;
}

export function decodeTicket(ticket) {
  const [data, sig] = String(ticket || '').split('.');
  if (!data || !sig) throw new Error('Invalid job ticket');
  const expected = crypto.createHmac('sha256', secret()).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid job signature');
  return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
}

export function safeRepoName(input) {
  return String(input || 'aihq-project')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'aihq-project';
}

export function safePath(input) {
  const p = String(input || '').replace(/^\/+/, '').replace(/\\/g, '/');
  if (!p || p.includes('..')) throw new Error('Unsafe file path');
  return p.slice(0, 240);
}

export function nowIso() {
  return new Date().toISOString();
}
