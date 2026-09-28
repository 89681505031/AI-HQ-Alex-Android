import { encodeTicket, safePath, safeRepoName, nowIso } from './utils.mjs';

const GH = 'https://api.github.com';
const VERCEL = 'https://api.vercel.com';

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token && process.env.AIHQ_MOCK !== '1') throw new Error('GITHUB_TOKEN is not configured');
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

async function gh(path, options = {}) {
  if (process.env.AIHQ_MOCK === '1') return mockGithub(path, options);
  const r = await fetch(GH + path, { ...options, headers: { ...ghHeaders(), ...(options.headers || {}) } });
  const raw = await r.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!r.ok) throw new Error(body?.message || `GitHub HTTP ${r.status}`);
  return body;
}

function owner() {
  const value = process.env.GITHUB_OWNER || '';
  if (!value && process.env.AIHQ_MOCK !== '1') throw new Error('GITHUB_OWNER is not configured');
  return value || 'mock-owner';
}

const workerWorkflow = [
  'name: AI HQ Worker',
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      task:',
  '        description: Task type',
  '        required: true',
  '        type: choice',
  '        options: [test, apk]',
  'jobs:',
  '  run:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: actions/setup-java@v5',
  '        with:',
  "          distribution: 'temurin'",
  "          java-version: '17'",
  '      - uses: actions/setup-node@v4',
  '        with:',
  "          node-version: '20'",
  '      - name: Run tests',
  "        if: ${{ inputs.task == 'test' }}",
  '        shell: bash',
  '        run: |',
  '          set -e',
  '          if [ -f package.json ]; then',
  '            if [ -f package-lock.json ]; then npm ci; else npm install; fi',
  '            npm test --if-present',
  '            npm run build --if-present',
  '          elif [ -f gradlew ]; then',
  '            chmod +x gradlew',
  '            ./gradlew test',
  '          else',
  '            echo "No supported test runner found"',
  '          fi',
  '      - name: Build APK',
  "        if: ${{ inputs.task == 'apk' }}",
  '        shell: bash',
  '        run: |',
  '          set -e',
  '          if [ ! -f gradlew ]; then echo "gradlew not found"; exit 2; fi',
  '          chmod +x gradlew',
  '          ./gradlew assembleDebug',
  '      - name: Collect APK',
  "        if: ${{ inputs.task == 'apk' }}",
  '        shell: bash',
  '        run: |',
  '          mkdir -p aihq-out',
  "          find . -type f -path '*/build/outputs/apk/*/*.apk' -exec cp {} aihq-out/ \\;",
  '          ls -la aihq-out',
  '      - name: Upload APK',
  "        if: ${{ inputs.task == 'apk' }}",
  '        uses: actions/upload-artifact@v4',
  '        with:',
  '          name: aihq-apk',
  '          path: aihq-out/*.apk',
  '          if-no-files-found: error',
  ''
].join('\n');

async function getContent(repo, path, ref = 'main') {
  try {
    return await gh(`/repos/${owner()}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`);
  } catch (e) {
    if (/404|Not Found/i.test(String(e.message || e))) return null;
    throw e;
  }
}

async function putContent(repo, path, content, message, branch = 'main') {
  const current = await getContent(repo, path, branch);
  const body = { message, content: Buffer.from(content).toString('base64'), branch };
  if (current?.sha) body.sha = current.sha;
  return gh(`/repos/${owner()}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

export async function createRepo(payload = {}) {
  const name = safeRepoName(payload.repoName || payload.name || payload.projectName);
  if (process.env.AIHQ_MOCK === '1') {
    return { status: 'success', result: { owner: owner(), repo: name, html_url: `https://github.com/${owner()}/${name}` } };
  }
  let remote;
  try {
    remote = await gh('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        private: !!payload.private,
        auto_init: true,
        description: payload.description || 'Created by AI HQ'
      })
    });
  } catch (e) {
    if (/name already exists|422/i.test(String(e.message || e))) remote = await gh(`/repos/${owner()}/${name}`);
    else throw e;
  }
  await putContent(name, '.github/workflows/aihq-worker.yml', workerWorkflow, 'Add AI HQ worker workflow');
  return {
    status: 'success',
    result: {
      owner: remote.owner?.login || owner(),
      repo: remote.name || name,
      repoId: remote.id,
      html_url: remote.html_url || `https://github.com/${owner()}/${name}`
    }
  };
}

export async function commitFiles(payload = {}) {
  const repo = safeRepoName(payload.repoName || payload.repo || payload.projectName);
  const files = Array.isArray(payload.files) ? payload.files.slice(0, 50) : [];
  if (!files.length) files.push({ path: 'AIHQ-NOTES.md', content: payload.fallbackContent || '# AI HQ\n\nNo workspace files were supplied.' });
  const written = [];
  for (const file of files) {
    const path = safePath(file.path || file.name || 'file.txt');
    const content = String(file.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > 500000) throw new Error(`File too large: ${path}`);
    await putContent(repo, path, content, `AI HQ: update ${path}`, payload.branch || 'main');
    written.push(path);
  }
  await putContent(repo, '.github/workflows/aihq-worker.yml', workerWorkflow, 'Ensure AI HQ worker workflow');
  return { status: 'success', result: { owner: owner(), repo, files: written, branch: payload.branch || 'main', html_url: `https://github.com/${owner()}/${repo}` } };
}

export async function dispatchWorkflow(payload = {}, task = 'test') {
  const repo = safeRepoName(payload.repoName || payload.repo || payload.projectName);
  const ref = payload.ref || 'main';
  const since = nowIso();
  if (process.env.AIHQ_MOCK !== '1') {
    await gh(`/repos/${owner()}/${repo}/actions/workflows/aihq-worker.yml/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref, inputs: { task } })
    });
  }
  const ticket = encodeTicket({ provider: 'github-actions', owner: owner(), repo, workflow: 'aihq-worker.yml', task, ref, since });
  return {
    id: ticket,
    status: process.env.AIHQ_MOCK === '1' ? 'success' : 'running',
    progress: process.env.AIHQ_MOCK === '1' ? 100 : 5,
    result: process.env.AIHQ_MOCK === '1' ? { mock: true, task, repo } : null
  };
}

async function vercelFetch(path, options = {}) {
  const token = process.env.VERCEL_TOKEN || '';
  if (!token && process.env.AIHQ_MOCK !== '1') throw new Error('VERCEL_TOKEN is not configured');
  if (process.env.AIHQ_MOCK === '1') return { id: 'dpl_mock', url: 'mock-project.vercel.app', readyState: 'READY' };
  const teamId = process.env.VERCEL_TEAM_ID || '';
  const sep = path.includes('?') ? '&' : '?';
  const url = VERCEL + path + (teamId ? `${sep}teamId=${encodeURIComponent(teamId)}` : '');
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const raw = await r.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!r.ok) throw new Error(body?.error?.message || body?.message || `Vercel HTTP ${r.status}`);
  return body;
}

export async function deployVercel(payload = {}) {
  const repo = safeRepoName(payload.repoName || payload.repo || payload.projectName);
  const repoInfo = await gh(`/repos/${owner()}/${repo}`);
  const project = process.env.VERCEL_PROJECT_ID || payload.vercelProjectId || '';
  if (!project && process.env.AIHQ_MOCK !== '1') throw new Error('VERCEL_PROJECT_ID is not configured');
  const body = {
    name: process.env.VERCEL_PROJECT_NAME || payload.vercelProjectName || repo,
    project,
    gitSource: { type: 'github', repoId: repoInfo.id, ref: payload.ref || 'main' }
  };
  if (payload.environment === 'production') body.target = 'production';
  const deployment = await vercelFetch('/v13/deployments', { method: 'POST', body: JSON.stringify(body) });
  const ticket = encodeTicket({ provider: 'vercel', deploymentId: deployment.id, url: deployment.url || '' });
  const ready = deployment.readyState === 'READY' || deployment.status === 'READY';
  return {
    id: ticket,
    status: ready ? 'success' : 'running',
    progress: ready ? 100 : 10,
    result: ready ? { url: deployment.url ? 'https://' + deployment.url : '' } : null,
    artifacts: deployment.url ? [{ name: 'Vercel deployment', url: 'https://' + deployment.url }] : []
  };
}

export async function publishRelease(payload = {}) {
  const repo = safeRepoName(payload.repoName || payload.repo || payload.projectName);
  const tag = payload.tag || `aihq-${Date.now()}`;
  if (process.env.AIHQ_MOCK === '1') {
    return { status: 'success', result: { html_url: `https://github.com/${owner()}/${repo}/releases/tag/${tag}`, tag } };
  }
  const body = await gh(`/repos/${owner()}/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: payload.name || `AI HQ release ${tag}`,
      body: payload.notes || 'Published by AI HQ after director approval.',
      draft: false,
      prerelease: !!payload.prerelease,
      target_commitish: payload.ref || 'main'
    })
  });
  return { status: 'success', result: { html_url: body.html_url, tag: body.tag_name, id: body.id } };
}

export async function pollGithubActions(ticket) {
  if (process.env.AIHQ_MOCK === '1') return { status: 'success', progress: 100, result: { mock: true } };
  const path = `/repos/${ticket.owner}/${ticket.repo}/actions/workflows/${ticket.workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ticket.ref)}&per_page=20`;
  const body = await gh(path);
  const since = Date.parse(ticket.since) - 10000;
  const runs = (body.workflow_runs || []).filter(r => Date.parse(r.created_at) >= since);
  const run = runs[0];
  if (!run) return { status: 'running', progress: 10 };
  if (run.status !== 'completed') return { status: 'running', progress: 55, result: { run_url: run.html_url } };
  const ok = run.conclusion === 'success';
  const artifacts = [{ name: `GitHub Actions: ${ticket.task}`, url: run.html_url }];
  if (ticket.task === 'apk' && ok) {
    try {
      const a = await gh(`/repos/${ticket.owner}/${ticket.repo}/actions/runs/${run.id}/artifacts`);
      for (const x of a.artifacts || []) artifacts.push({ name: x.name, url: run.html_url, artifactId: x.id });
    } catch {}
  }
  return {
    status: ok ? 'success' : 'failed',
    progress: 100,
    result: { run_id: run.id, run_url: run.html_url, conclusion: run.conclusion },
    error: ok ? '' : `GitHub Actions: ${run.conclusion}`,
    artifacts
  };
}

export async function pollVercel(ticket) {
  if (process.env.AIHQ_MOCK === '1') return { status: 'success', progress: 100, result: { url: 'https://mock-project.vercel.app' } };
  const d = await vercelFetch(`/v13/deployments/${encodeURIComponent(ticket.deploymentId)}`);
  const state = d.readyState || d.status || '';
  if (state === 'READY') return {
    status: 'success',
    progress: 100,
    result: { url: d.url ? 'https://' + d.url : '' },
    artifacts: d.url ? [{ name: 'Vercel deployment', url: 'https://' + d.url }] : []
  };
  if (['ERROR','CANCELED'].includes(state)) return { status: 'failed', progress: 100, error: state };
  return { status: 'running', progress: state === 'BUILDING' ? 65 : 30 };
}

function mockGithub(path, options) {
  if (path.includes('/actions/workflows/')) return {};
  if (path.startsWith('/user/repos')) return { id: 123, name: 'mock-repo', owner: { login: 'mock-owner' }, html_url: 'https://github.com/mock-owner/mock-repo' };
  if (/\/repos\/[^/]+\/[^/]+$/.test(path)) return { id: 123, name: path.split('/').pop(), owner: { login: 'mock-owner' }, html_url: 'https://github.com/mock-owner/mock-repo' };
  if (path.includes('/contents/')) return options?.method === 'PUT' ? { content: { sha: 'mock' } } : null;
  if (path.includes('/releases')) return { id: 1, html_url: 'https://github.com/mock/release', tag_name: 'mock-tag' };
  return {};
}
