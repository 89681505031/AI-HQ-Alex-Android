process.env.AIHQ_MOCK = '1';
process.env.AIHQ_SESSION_TOKEN = 'test-session';
process.env.AIHQ_JOB_SECRET = 'test-secret';
process.env.GITHUB_OWNER = 'mock-owner';

const {
  createRepo, commitFiles, dispatchWorkflow, deployVercel, publishRelease,
  pollGithubActions, pollVercel
} = await import('../lib/providers.mjs');
const { decodeTicket } = await import('../lib/utils.mjs');

function ok(value, message) {
  if (!value) throw new Error(message);
}

const repo = await createRepo({ repoName: 'Nova-App' });
ok(repo.status === 'success' && repo.result.repo === 'Nova-App', 'createRepo failed');

const commit = await commitFiles({
  repoName: 'Nova-App',
  files: [
    { path: 'README.md', content: '# Nova' },
    { path: 'src/app.js', content: 'console.log("Nova")' }
  ]
});
ok(commit.status === 'success' && commit.result.files.length === 2, 'commitFiles failed');

const testJob = await dispatchWorkflow({ repoName: 'Nova-App', ref: 'main' }, 'test');
ok(testJob.status === 'success', 'test workflow failed in mock mode');
ok(decodeTicket(testJob.id).provider === 'github-actions', 'GitHub ticket invalid');
ok((await pollGithubActions(decodeTicket(testJob.id))).status === 'success', 'GitHub poll failed');

const deploy = await deployVercel({ repoName: 'Nova-App', environment: 'preview' });
ok(deploy.status === 'success', 'Vercel deploy failed in mock mode');
ok(decodeTicket(deploy.id).provider === 'vercel', 'Vercel ticket invalid');
ok((await pollVercel(decodeTicket(deploy.id))).status === 'success', 'Vercel poll failed');

const release = await publishRelease({ repoName: 'Nova-App', tag: 'v-test' });
ok(release.status === 'success', 'release failed');

console.log(JSON.stringify({
  ok: true,
  createRepo: repo.result.repo,
  committed: commit.result.files.length,
  githubJob: testJob.status,
  vercel: deploy.status,
  release: release.status
}, null, 2));
