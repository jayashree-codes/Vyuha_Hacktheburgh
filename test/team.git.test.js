// Team context git layer against real git with temporary bare remotes. Run: node test/team.git.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Team, BRANCH } = require('../src/team');
const H = require('./team-helpers');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
const now = H.clock('2026-11-08T09:00:00Z');
const asha = { id: 'asha-example-com', name: 'Asha', email: 'asha@example.com' };
const priya = { id: 'priya-example-com', name: 'Priya', email: 'priya@example.com' };

(async () => {
  // no remote: a clear error
  {
    const lonely = path.join(H.tmpRoot, 'lonely');
    fs.mkdirSync(lonely, { recursive: true });
    H.g(lonely, 'init', '-q', '-b', 'main');
    const t = new Team({ root: lonely, project: 'lonely', now });
    let err = null;
    try { await t.setup(); } catch (e) { err = e; }
    ok(err && /Publish this project to GitHub first/.test(err.message), 'a project without a remote gets a clear error');
    ok(!fs.existsSync(path.join(lonely, '.vyuha', 'team')), '…and no worktree is created');
  }

  const bare = H.makeRemote('gitlayer');
  const a = H.cloneFor(bare, asha, 'gitlayer');
  const p = H.cloneFor(bare, priya, 'gitlayer');
  const mainBefore = H.g(bare, 'rev-parse', 'main');
  const filesBefore = H.g(bare, 'ls-tree', '-r', '--name-only', 'main');

  const A = new Team({ root: a, project: 'gitlayer', now, random: H.rng(1) });
  const P = new Team({ root: p, project: 'gitlayer', now, random: H.rng(2) });

  // first setup creates the orphan branch
  const sa = await A.setup();
  ok(sa.created, 'first setup creates the context');
  const tj = JSON.parse(H.g(bare, 'show', `${BRANCH}:team.json`));
  ok(tj.createdBy === asha.id && tj.version === 1 && tj.takeoverAfterMinutes === 120, 'team.json on the remote names the creator');
  ok(H.g(bare, 'rev-list', '--max-parents=0', BRANCH) === H.g(bare, 'rev-parse', BRANCH), `${BRANCH} is an orphan (one root commit, no shared history)`);
  let common = true; try { H.g(bare, 'merge-base', 'main', BRANCH); } catch (e) { common = false; }
  ok(!common, `${BRANCH} shares no history with main (git merge-base finds nothing)`);
  ok(H.g(bare, 'rev-parse', 'main') === mainBefore && H.g(bare, 'ls-tree', '-r', '--name-only', 'main') === filesBefore, 'main is unchanged on the remote');
  ok(H.g(a, 'status', '--porcelain') === '', 'the code checkout stays clean (.vyuha is excluded)');
  ok(Team.isEnabled(a) && !Team.isEnabled(p), 'isEnabled is per project');

  // join
  const sp = await P.setup();
  ok(!sp.created && sp.state.fold.creator === asha.id, 'second setup joins and sees the creator');

  // events + publish
  await A.emit('phase_created', { phaseId: 'ph1', name: 'planning', plannedBy: asha.id });
  await A.emit('task_added', { phaseId: 'ph1', taskId: 't1', text: 'Write the brief' });
  const pa = await A.publish();
  ok(pa.ok && pa.attempts === 1, 'publish succeeds');
  ok(JSON.parse(H.g(bare, 'show', `${BRANCH}:people/${asha.id}/profile.json`)).name === 'Asha', 'my profile is on the branch');
  ok(H.g(bare, 'show', `${BRANCH}:people/${asha.id}/events.jsonl`).split('\n').length === 2, 'my events are on the branch');
  ok(/\| 1 \| planning \| _unowned_ \| 0\/1 \|/.test(H.g(bare, 'show', `${BRANCH}:TEAM.md`)), 'TEAM.md has the overview table');

  const pulled = await P.pull();
  ok(pulled.fold.phases.length === 1 && pulled.fold.phases[0].tasks[0].text === 'Write the brief', 'pull brings in the teammate’s plan');

  // race: both publish at once; no conflicts, both present
  await P.emit('task_claimed', { phaseId: 'ph1', taskId: 't1' });
  now.minutes(1);
  await A.emit('task_done', { phaseId: 'ph1', taskId: 't1' });
  const [r1, r2] = await Promise.all([A.publish(), P.publish()]);
  ok(r1.ok && r2.ok, `both racing publishes succeed (attempts ${r1.attempts} and ${r2.attempts})`);
  const final = await A.pull();
  ok(final.fold.phases[0].tasks[0].done && final.fold.phases[0].tasks[0].assignee === priya.id, 'both events are in the fold after the race');
  ok(H.g(bare, 'show', `${BRANCH}:people/${priya.id}/events.jsonl`).includes('task_claimed'), 'the race did not lose Priya’s event');

  // worktree can be hard reset safely: my folder is regenerated from team-local
  fs.writeFileSync(path.join(a, '.vyuha', 'team', 'people', asha.id, 'events.jsonl'), 'garbage\n');
  await A.publish();
  ok(H.g(bare, 'show', `${BRANCH}:people/${asha.id}/events.jsonl`).split('\n').length === 3, 'my folder is regenerated from local files on publish');

  // nothing new: no empty commit
  const head = H.g(bare, 'rev-parse', BRANCH);
  const again = await A.publish();
  ok(again.nothing && H.g(bare, 'rev-parse', BRANCH) === head, 'publishing with no changes adds no commit');

  // a stale worktree folder is recovered by setup
  const res = await P.setup();
  ok(!res.created && res.state.fold.phases.length === 1, 'setup again on an existing worktree just pulls');

  console.log('all team git checks passed');
})().catch(e => { console.error(e); process.exit(1); });
