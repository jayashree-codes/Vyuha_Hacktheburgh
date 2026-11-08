// Team context: full simulation with five people, three projects, real git. Run: node test/team.sim.test.js
// Plain node, no Electron: everything goes through team.js / team-plan.js and the same hook functions main.js calls.
// Fake clock, fake Gemini (fixed JSON for extractIssue), one bare remote per project, one clone per member per project.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('../src/team');
const tp = require('../src/team-plan');
const agent = require('../src/agent');
const { Store } = require('../src/store');
const { Behaviour, X_NAMES, SHARED_X } = require('../src/behaviour');
const H = require('./team-helpers');

const now = H.clock('2026-11-09T08:00:00Z');
const MIN = 60e3, HOUR = 3600e3;
const PEOPLE = {
  asha: { name: 'Asha', email: 'asha@shop.dev' },
  priya: { name: 'Priya', email: 'priya@shop.dev' },
  ravi: { name: 'Ravi', email: 'ravi@shop.dev' },
  meera: { name: 'Meera', email: 'meera@shop.dev' },
  tom: { name: 'Tom', email: 'tom@shop.dev' }
};
for (const [k, p] of Object.entries(PEOPLE)) { p.key = k; p.id = T.slugId(p.email); p.home = path.join(H.tmpRoot, 'homes', k); fs.mkdirSync(p.home, { recursive: true }); }
const ID = k => PEOPLE[k].id;
// Simulated prompts and transcript text: none of this may ever reach a vyuha_context branch
const PROMPTS = {
  asha: 'PROMPT-ASHA-91f: plan the shop login for me, my manager wants it by friday',
  priya: 'PROMPT-PRIYA-7c1: why does login give 401 on my laptop, I think my token is wrong',
  ravi: 'PROMPT-RAVI-3b2: make the login page look like the figma, I am tired today',
  meera: 'PROMPT-MEERA-55d: is distilbert worth it over tf-idf for our sentiment data?',
  tom: 'PROMPT-TOM-0a9: run the tests and tell me what broke'
};
const FAKE_TOKEN = 'ghp_SIMFAKE0123456789abcdefXYZ';
const writeUpInputs = [];
const fakeGemini = { models: { generateContent: async () => ({ text: JSON.stringify({
  title: 'Login returns 401: session key not loaded from env',
  symptom: 'npm test fails with "Request failed with status code 401" on the login route',
  cause: 'auth/session.js used a hard-coded development key, so tokens signed by the API were rejected',
  fix: 'Read SESSION_SECRET from the environment in auth/session.js and add it to .env.example' }) }) } };

/* ---------- the world ---------- */
const remotes = { p1: H.makeRemote('shop-web'), p2: H.makeRemote('sentiment-classifier'), p3: H.makeRemote('chat-app') };
const PROJECT_NAME = { p1: 'shop-web', p2: 'sentiment-classifier', p3: 'chat-app' };
const ctxs = {};
const behaviours = {};
function rngFor(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return H.rng(h); }
function behaviourOf(k) {
  if (!behaviours[k]) behaviours[k] = new Behaviour(path.join(H.tmpRoot, 'behaviour', k), { now, random: H.rng(k === 'ravi' ? 2 : 1) });
  return behaviours[k];
}
// One member working on one project: their clone, Team, Vyuha store/project and plan operations
function ctx(k, proj, dirName = '') {
  const key = k + ':' + proj + (dirName ? ':' + dirName : '');
  if (ctxs[key]) return ctxs[key];
  const m = PEOPLE[k];
  const root = H.cloneFor(remotes[proj], m, PROJECT_NAME[proj], dirName || PROJECT_NAME[proj]);
  const sdir = path.join(H.tmpRoot, 'stores', key.replace(/:/g, '-'));
  fs.mkdirSync(sdir, { recursive: true }); fs.writeFileSync(path.join(sdir, 'README'), 'x');
  const store = new Store(path.join(sdir, 'projects'), path.join(sdir, 'folders.json'));
  const pid = store.openFolder(root);
  const tm = new T.Team({ root, project: PROJECT_NAME[proj], now, random: rngFor(key), home: m.home,
    writeUp: input => { writeUpInputs.push(input); return agent.extractIssue({ client: fakeGemini, model: 'fake', ...input }); } });
  const c = { k, m, proj, root, store, pid, tm, get ops() { return tp.planOps(store, pid, T.Team.isEnabled(root) ? tm : null); } };
  return (ctxs[key] = c);
}
// What a member types to Gemini stays local: behaviour numbers + the local chat transcript
function chatLocally(c, reply) {
  behaviourOf(c.k).begin(c.pid, PROMPTS[c.k], { typing: { keys: 60, activeMs: 9000, pauses: 1, backspaces: 3 }, context: { mode: 'build' } });
  const chat = c.store.readChat(c.pid);
  chat.transcript.push({ role: 'user', text: PROMPTS[c.k], at: now() }, { role: 'agent', text: reply, at: now() + 1 });
  chat.history = [{ role: 'user', parts: [{ text: PROMPTS[c.k] }] }];
  c.store.writeChat(c.pid, chat);
}
const phaseOf = (st, name) => st.fold.phases.find(p => p.name === name);
const taskOf = (st, phase, text) => phaseOf(st, phase).tasks.find(t => t.text === text);
const remoteFile = (proj, file) => H.g(remotes[proj], 'show', `${T.BRANCH}:${file}`);
const remoteHas = (proj, file) => { try { remoteFile(proj, file); return true; } catch (e) { return false; } };
const err401 = (dir, line, port, extra = '') => `> shop-web@1.0.0 test\n> node test/login.test.js\n\n  login\n    1) signs in\n\nError: Request failed with status code 401\n    at login (${dir}${path.sep}auth${path.sep}session.js:${line}:13)\n    at POST http://localhost:${port}/api/login${extra}\n1 failing (${line}ms)\n[exit 1]`;

/* ---------- scenario runner ---------- */
const results = [];
async function scenario(n, title, fn) {
  const t0 = Date.now();
  const keys = [];
  const check = (cond, msg) => { assert.ok(cond, msg); keys.push(msg); console.log(`  ok  ${msg}`); };
  console.log(`\n# ${n}. ${title}`);
  try { await fn(check); results.push({ n, title, ok: true, key: keys[keys.length > 1 ? 1 : 0] || '', all: keys, ms: Date.now() - t0 }); }
  catch (e) { console.log(`  FAIL ${e.message}`); if (!(e instanceof assert.AssertionError)) console.log(e.stack); results.push({ n, title, ok: false, key: e.message, all: keys, ms: Date.now() - t0 }); }
}

(async () => {
  const mainBefore = H.g(remotes.p1, 'rev-parse', 'main');
  const filesBefore = H.g(remotes.p1, 'ls-tree', '-r', '--name-only', 'main');

  await scenario(1, 'Setup: first publish creates the orphan branch', async check => {
    const a = ctx('asha', 'p1');
    a.store.setPlan(a.pid, [{ name: 'Planning', goal: 'Agree what we build', tasks: ['Write the brief', 'Agree scope'] }], 'Planning');
    chatLocally(a, 'Here is a plan for the login work.');
    const r = await a.tm.setup();
    await tp.importLocalPlan(a.store, a.pid, a.tm);
    await a.tm.publish();
    const tj = JSON.parse(remoteFile('p1', 'team.json'));
    check(r.created && tj.createdBy === ID('asha'), `vyuha_context exists on the remote with team.json createdBy ${tj.createdBy}`);
    check(H.g(remotes.p1, 'rev-parse', 'main') === mainBefore && H.g(remotes.p1, 'ls-tree', '-r', '--name-only', 'main') === filesBefore,
      `main still at ${mainBefore.slice(0, 8)} with the same ${filesBefore.split('\n').length} files`);
    let common = true; try { H.g(remotes.p1, 'merge-base', 'main', T.BRANCH); } catch (e) { common = false; }
    check(!common, 'vyuha_context shares no history with main (orphan)');
    const lonely = path.join(H.tmpRoot, 'lonely'); fs.mkdirSync(lonely, { recursive: true }); H.g(lonely, 'init', '-q', '-b', 'main');
    let err = null; try { await new T.Team({ root: lonely, project: 'lonely', now }).setup(); } catch (e) { err = e; }
    check(err && /Publish this project to GitHub first/.test(err.message), `a project with no remote: "${err && err.message.split(':')[0]}"`);
  });

  await scenario(2, 'Join: teammates set up from the remote', async check => {
    for (const k of ['priya', 'ravi', 'tom']) { const c = ctx(k, 'p1'); const r = await c.tm.setup(); assert.ok(!r.created, k + ' joined'); }
    const p = ctx('priya', 'p1');
    const st = await p.tm.state();
    check(H.g(path.join(p.root, '.vyuha', 'team'), 'rev-parse', 'HEAD') === H.g(remotes.p1, 'rev-parse', T.BRANCH), 'Priya\u2019s worktree is checked out from origin/vyuha_context');
    check(st.fold.creator === ID('asha') && phaseOf(st, 'planning') && phaseOf(st, 'planning').tasks.length === 2, `Priya's fold: creator ${T.nameOf(st.fold, st.fold.creator)}, Asha's plan with ${phaseOf(st, 'planning').tasks.length} tasks`);
    await p.ops.sync();
    check(p.store.get(p.pid).phases.join() === '1-planning', 'her local phases follow the team plan');
  });

  await scenario(3, 'Planning ownership', async check => {
    now.advance(10 * MIN);
    const a = ctx('asha', 'p1');
    await a.ops.setPlan([
      { name: 'planning', tasks: ['Write the brief', 'Agree scope'] },
      { name: 'backend', goal: 'The login API works end to end', tasks: ['Connect login API', 'Session store'] },
      { name: 'frontend', tasks: ['Build login page', 'Form validation'] },
      { name: 'testing', tasks: ['E2E login test'] }], 'planning');
    await a.tm.publish();
    const st = await a.tm.state();
    check(phaseOf(st, 'planning').owner === ID('asha'), 'planning is owned by Asha');
    check(['backend', 'frontend', 'testing'].every(n => phaseOf(st, n).owner === null && phaseOf(st, n).plannedBy === ID('asha')), 'backend, frontend, testing are unowned, plannedBy Asha');
  });

  await scenario(4, 'Parallel start while the creator is away (publish race)', async check => {
    now.advance(2 * HOUR);
    const p = ctx('priya', 'p1'), r = ctx('ravi', 'p1');
    await p.tm.pull(); await r.tm.pull();
    await p.ops.claimTask('backend', 'Connect login API');
    await r.ops.claimTask('frontend', 'Build login page');
    const [a, b] = await Promise.all([p.tm.publish(), r.tm.publish()]);
    check(a.ok && b.ok, `both pushes succeed (attempts: Priya ${a.attempts}, Ravi ${b.attempts}; retries ${a.attempts + b.attempts - 2})`);
    check(remoteFile('p1', `people/${ID('priya')}/events.jsonl`).includes('task_claimed') && remoteFile('p1', `people/${ID('ravi')}/events.jsonl`).includes('task_claimed'), 'both claim events are on the remote, no merge conflicts');
    const st = await ctx('tom', 'p1').tm.pull();
    check(phaseOf(st, 'backend').owner === ID('priya') && phaseOf(st, 'frontend').owner === ID('ravi'), 'fold: backend owned by Priya, frontend owned by Ravi');
  });

  await scenario(5, 'Wrong automatic claim, fixed by reassigning', async check => {
    now.advance(5 * MIN);
    const r = ctx('ravi', 'p1');
    await r.ops.claimTask('backend', 'Session store');                   // the mistake
    let st = await r.tm.state();
    assert.ok(taskOf(st, 'backend', 'Session store').assignee === ID('ravi'));
    const ph = phaseOf(st, 'backend');
    await r.ops.assign(ph.id, taskOf(st, 'backend', 'Session store').id, ID('priya'));
    await r.ops.claimTask('frontend', 'Form validation');
    await r.tm.publish();
    st = await ctx('tom', 'p1').tm.pull();
    const who = (phase, task) => T.nameOf(st.fold, taskOf(st, phase, task).assignee);
    check(who('backend', 'Session store') === 'Priya', `latest assignment wins: Session store → ${who('backend', 'Session store')}`);
    check(who('frontend', 'Form validation') === 'Ravi' && who('frontend', 'Build login page') === 'Ravi' && who('backend', 'Connect login API') === 'Priya' && phaseOf(st, 'backend').owner === ID('priya'),
      'team page data: Connect login API/Session store → Priya, Build login page/Form validation → Ravi; backend still Priya\u2019s');
  });

  await scenario(6, 'Authority: renaming someone else\u2019s phase', async check => {
    const r = ctx('ravi', 'p1');
    let err = null;
    try { await r.ops.renamePhase('2-backend', 'ravi-backend'); } catch (e) { err = e; }
    const st = await r.tm.state();
    const rej = st.fold.rejected.find(x => x.event.type === 'phase_renamed' && x.event.by === ID('ravi'));
    check(err instanceof tp.Rejected && rej && /only Priya/.test(rej.reason), `event rejected: "${rej && rej.reason}"`);
    check(phaseOf(st, 'backend') && !st.fold.phases.some(p => p.name === 'ravi-backend') && r.store.get(r.pid).phases.includes('2-backend'), 'the name is unchanged (team and local)');
    await r.tm.publish();
  });

  await scenario(7, 'Reorder: creator only', async check => {
    const p = ctx('priya', 'p1'), a = ctx('asha', 'p1');
    await p.tm.pull();
    let err = null;
    try { await p.ops.movePhase('4-testing', -1); } catch (e) { err = e; }
    let st = await p.tm.state();
    check(err instanceof tp.Rejected && st.fold.phases.map(x => x.name).join() === 'planning,backend,frontend,testing', `Priya's reorder rejected: "${err && err.message}"`);
    await p.tm.publish();
    await a.tm.pull(); await a.ops.sync();
    await a.ops.movePhase('4-testing', -1);
    await a.tm.publish();
    st = await ctx('tom', 'p1').tm.pull();
    check(st.fold.phases.map(x => x.name).join() === 'planning,backend,testing,frontend', `Asha's reorder accepted: ${st.fold.phases.map(x => x.name).join(' → ')}`);
    check(a.store.get(a.pid).phases.join() === '1-planning,2-backend,3-testing,4-frontend', 'local phases are renumbered to match');
  });

  await scenario(8, 'Handoff on P3', async check => {
    const r = ctx('ravi', 'p3');
    const res = await r.tm.setup();
    assert.ok(res.created);
    await r.ops.setPlan([{ name: 'design', tasks: ['Wireframes'] }, { name: 'realtime', tasks: ['WebSocket server'] }, { name: 'ui', tasks: ['Message list', 'Composer'] }], 'ui');
    await r.tm.publish();
    for (const k of ['asha', 'priya', 'meera', 'tom']) await ctx(k, 'p3').tm.setup();
    now.advance(15 * MIN);
    const ui = phaseOf(await r.tm.state(), 'ui');
    await r.ops.handoff(ui.id, ID('meera'));
    await r.tm.publish();
    const st = await ctx('meera', 'p3').tm.pull();
    const log = st.fold.ownershipLog.find(l => l.action === 'handed off');
    check(phaseOf(st, 'ui').owner === ID('meera'), 'ui is now owned by Meera');
    check(log && log.from === ID('ravi') && log.to === ID('meera'), `ownershipLog: ${log && `${log.action} ${T.nameOf(st.fold, log.from)} → ${T.nameOf(st.fold, log.to)}`}`);
  });

  await scenario(9, 'Takeover and takeback', async check => {
    const p = ctx('priya', 'p1'), tom = ctx('tom', 'p1'), r = ctx('ravi', 'p1');
    now.advance(MIN);
    await p.ops.updateNotes('2-backend', '**Status**: API client drafted.', true);
    const st0 = await p.tm.state();
    await p.tm.emit('task_assigned', { phaseId: phaseOf(st0, 'backend').id, taskId: taskOf(st0, 'backend', 'Connect login API').id, to: ID('priya') });   // her latest activity
    await p.tm.publish();
    const lastPriya = (await p.tm.state()).fold.lastActivity[ID('priya')];
    now.advance(30 * MIN);
    await tom.tm.pull();
    const be = phaseOf(await tom.tm.state(), 'backend');
    let early = null; try { await tom.ops.takeover(be.id); } catch (e) { early = e; }
    check(early instanceof tp.Rejected && /active 30 min ago/.test(early.message), `30 min after Priya's last event: rejected ("${early && early.message}")`);
    now.advance(3 * HOUR);
    await tom.ops.takeover(be.id);
    await tom.tm.publish();
    let st = await p.tm.pull();
    const took = st.fold.ownershipLog.find(l => l.action === 'took over');
    check(phaseOf(st, 'backend').owner === ID('tom') && took && took.takenFrom === ID('priya'), `after 3 h: accepted, logged as taken from ${took && T.nameOf(st.fold, took.takenFrom)} (Priya last active ${lastPriya})`);
    await p.ops.takeback(be.id);
    await p.tm.publish();
    await r.tm.pull();
    let rerr = null; try { await r.ops.takeback(be.id); } catch (e) { rerr = e; }
    await r.tm.publish();
    st = await tom.tm.pull();
    check(phaseOf(st, 'backend').owner === ID('priya') && st.fold.ownershipLog.some(l => l.action === 'took back' && l.to === ID('priya')), 'Priya takes it back: accepted');
    check(rerr instanceof tp.Rejected && st.fold.rejected.some(x => x.event.type === 'phase_takeback' && x.event.by === ID('ravi')), `Ravi's takeback: rejected ("${rerr && rerr.message}")`);
  });

  await scenario(10, 'Progress from three people; TEAM.md matches the fold', async check => {
    const a = ctx('asha', 'p1'), p = ctx('priya', 'p1'), r = ctx('ravi', 'p1');
    for (const c of [a, p, r]) { await c.tm.pull(); await c.ops.sync(); }
    now.advance(10 * MIN);
    await a.ops.updateTask('1-planning', 'Write the brief', true);
    await a.ops.toggleTask('1-planning', 1);                          // "Agree scope" by checklist index
    await p.ops.updateTask('2-backend', 'Connect login API', true);
    await r.ops.updateTask('4-frontend', 'Build login page', true);
    await r.ops.updateTask('4-frontend', 'Form validation', true);
    now.advance(MIN);
    await r.ops.updateTask('4-frontend', 'Form validation', false);   // reopened
    await Promise.all([a.tm.publish(), p.tm.publish(), r.tm.publish()]);
    const tom = ctx('tom', 'p1');
    const st = await tom.tm.pull();
    const prog = n => `${phaseOf(st, n).progress.done}/${phaseOf(st, n).progress.total}`;
    check(prog('planning') === '2/2' && prog('backend') === '1/2' && prog('frontend') === '1/2' && prog('testing') === '0/1',
      `fold: planning ${prog('planning')}, backend ${prog('backend')}, frontend ${prog('frontend')} (reopen counts as not done), testing ${prog('testing')}`);
    await tom.tm.emit('task_claimed', { phaseId: phaseOf(st, 'testing').id, taskId: taskOf(st, 'testing', 'E2E login test').id });
    await tom.tm.publish();
    const md = remoteFile('p1', 'TEAM.md');
    const row = (n, owner, pr) => new RegExp(`\\| ${n} \\| ${owner} \\| ${pr.replace('/', '\\/')} \\|`).test(md);
    check(row('planning', 'Asha', '2/2') && row('backend', 'Priya', '1/2') && row('frontend', 'Ravi', '1/2') && row('testing', 'Tom', '0/1'), 'TEAM.md progress table matches the fold');
    check(a.store.get(a.pid).phaseNotes['1-planning'].includes('- [x] Write the brief') && /\[x\] Agree scope/.test(a.store.get(a.pid).phaseNotes['1-planning']), 'local checklists show the ticks');
  });

  let priyaIssueId = null;
  await scenario(11, 'Issue lifecycle (Gemini path) on P1', async check => {
    const p = ctx('priya', 'p1');
    chatLocally(p, 'The 401 comes from auth/session.js using a hard-coded key; read SESSION_SECRET from the environment instead.');
    const steps = [];
    const run = async (output, code, command = 'npm test') => T.geminiCommandHook(p.tm, { command, result: { code, output }, step: s => steps.push(s), ...tp.commandContext(p.store, p.pid) });
    now.advance(MIN);
    await run(err401(p.root, 41, 3001), 1);
    now.advance(2 * MIN);
    await run(err401(p.root, 58, 3017, `\n    using token ${FAKE_TOKEN}`), 1);
    let list = p.tm.localIssues();
    check(list.length === 1 && list[0].attempts === 2 && list[0].status === 'open', `two 401 failures (lines 41/58, ports 3001/3017) → one open issue, attempts ${list[0].attempts}`);
    now.advance(MIN);
    const saved = p.store.writeCode(p.pid, 'auth/session.js', 'module.exports = { key: process.env.SESSION_SECRET };\n');   // write_file
    p.tm.noteFileWritten(saved);
    chatLocally(p, 'I updated auth/session.js; run npm test again.');
    now.advance(MIN);
    const ok = await run('  login\n    ✓ signs in\n\n  1 passing\n[exit 0]', 0);
    await ok.writeUps;
    list = p.tm.localIssues();
    priyaIssueId = list[0].id;
    check(list[0].status === 'fixed' && list[0].filesChanged.includes('auth/session.js'), `fixed; filesChanged = ${JSON.stringify(list[0].filesChanged)}`);
    check(writeUpInputs.length && writeUpInputs.every(i => !JSON.stringify(i).includes('PROMPT-')), 'the write-up got the error, diff and Gemini replies, none of her prompts');
    const edited = 'auth/session.js signed tokens with a hard-coded dev key; the API uses SESSION_SECRET (edited by Priya)';
    await p.tm.publish({ drafts: [{ id: priyaIssueId, cause: edited, include: true }] });
    const card = JSON.parse(remoteFile('p1', `people/${ID('priya')}/issues.json`))[0];
    check(card.cause === edited && card.title.startsWith('Login returns 401'), 'issues.json on the branch has her edited cause');
    const files = H.branchFiles(remotes.p1, T.BRANCH);
    check(!files.some(f => f.content.includes(PROMPTS.priya) || f.content.includes('PROMPT-PRIYA')), `her prompt appears in none of the ${files.length} files on the branch`);
  });

  await scenario(12, 'Match: a teammate hits the same error', async check => {
    const r = ctx('ravi', 'p1');
    await r.tm.pull();
    const steps = [];
    now.advance(10 * MIN);
    const out = err401(path.join(r.root, 'src', 'app'), 112, 5173);
    const res = await T.geminiCommandHook(r.tm, { command: 'npm test', result: { code: 1, output: out }, step: s => steps.push(s), ...tp.commandContext(r.store, r.pid) });
    const k = res.fields.team_knowledge;
    const cards = (await r.tm.state()).issues.filter(i => i.by !== ID('ravi'));
    const score = T.matchIssues(out, 'npm test', [], cards, { threshold: 0 })[0].score;
    const unrelated = "Traceback (most recent call last):\n  File \"scripts/seed.py\", line 9\nKeyError: 'SHOP_DB_URL'\n[exit 1]";
    const uScore = T.matchIssues(unrelated, 'python scripts/seed.py', [], cards, { threshold: 0 })[0].score;
    console.log(`  scores: same 401 → ${score}, unrelated KeyError → ${uScore} (threshold 0.55)`);
    check(k && k[0].by === 'Priya' && /401/.test(k[0].title) && k[0].fix.includes('SESSION_SECRET') && k[0].files.includes('auth/session.js'), `tool result has team_knowledge with Priya's card (score ${score})`);
    check(steps.some(s => s.kind === 'team' && s.label === `Team has seen this: ${k[0].title} (Priya)` && s.doc === 'team:issue:' + priyaIssueId), 'a chat step "Team has seen this" opens the card');
    const res2 = await T.geminiCommandHook(r.tm, { command: 'python scripts/seed.py', result: { code: 1, output: unrelated }, step: s => steps.push(s) });
    check(!res2.fields.team_knowledge, `an unrelated error gets no match (score ${uScore})`);
  });

  await scenario(13, 'Terminal path', async check => {
    const tom = ctx('tom', 'p1');
    await tom.tm.pull();
    const events = [];
    now.advance(5 * MIN);
    await T.terminalCommandHook(tom.tm, { command: 'npm test', result: { code: 1, output: err401('D:\\work\\tom\\shop-web', 7, 4000) }, notify: e => events.push(e), ...tp.commandContext(tom.store, tom.pid) });
    const ev = events.find(e => e.kind === 'match');
    check(ev && ev.cards[0].by === 'Priya' && ev.cards[0].issueId === priyaIssueId, `the banner event fires with Priya's card: "${ev && ev.cards[0].title}"`);
    const mine = tom.tm.localIssues();
    check(mine.length === 1 && mine[0].status === 'open' && !mine[0].published && mine[0].by === ID('tom'), 'Tom gets his own open, unpublished draft issue');
  });

  await scenario(14, 'Answer style: Ravi answers like Priya', async check => {
    const p = ctx('priya', 'p1'), r = ctx('ravi', 'p1');
    const pb = behaviourOf('priya');
    pb.p.settings.holdout = 0;
    for (let i = 0; i < 10; i++) { pb.begin(p.pid, i % 2 ? 'next step?' : 'add the session check', { override: 'stepwise', context: { mode: 'build' } }); now.advance(3 * MIN); pb.finish(p.pid, {}); now.advance(MIN); }
    pb.edit('add', { when: [{ feature: 'build_mode', op: '=', value: 1 }, { feature: 'open_question', op: '=', value: 0 }], style: 'stepwise', text: 'When I am building, walk me through it step by step.' });
    await p.tm.publish({ shareStyle: true, style: pb.exportStyle() });
    const style = JSON.parse(remoteFile('p1', `people/${ID('priya')}/style.json`));
    const rb = behaviourOf('ravi');
    rb.p.settings.holdout = 0;
    rb.begin(r.pid, PROMPTS.ravi, { context: { mode: 'teach' } }); now.advance(MIN); rb.finish(r.pid, {});
    for (let i = 0; i < 11; i++) { rb.begin(r.pid, 'what about caching ' + i, { typing: { keys: 20 + i, activeMs: 5000 }, context: { mode: 'teach' } }); now.advance(MIN); rb.finish(r.pid, {}); }
    rb.save();
    await r.tm.pull();
    const history = JSON.stringify(rb.p.history);
    const fileBefore = fs.readFileSync(rb.file, 'utf8');
    const mBefore = JSON.parse(JSON.stringify(rb.p.bandit));
    const before = rb.preview(r.pid, 'add the login form', {}, { mode: 'build' });
    const res = await T.importTeammateStyle(r.tm, rb, ID('priya'));
    check(JSON.stringify(rb.p.history) === history, 'Ravi\u2019s history is byte for byte unchanged');
    const blend = ['overview', 'stepwise', 'deep', 'clarify'].every(a => X_NAMES.every((n, i) => {
      const j = SHARED_X.indexOf(n);
      return j < 0 ? rb.p.bandit[a].m[i] === mBefore[a].m[i] && rb.p.bandit[a].q[i] === mBefore[a].q[i]
                   : Math.abs(rb.p.bandit[a].m[i] - (0.5 * mBefore[a].m[i] + 0.5 * style.arms[a].m[j])) < 1e-12;
    }));
    check(blend, 'shared weights = 0.5 × Ravi + 0.5 × Priya; Ravi’s own typing weights unchanged');
    const borrowed = rb.p.hypotheses.filter(h => h.status === 'borrowed');
    check(res.added >= 1 && borrowed.every(h => h.from === 'Priya'), `${borrowed.length} of Priya's rules borrowed, from Priya`);
    const after = rb.preview(r.pid, 'add the login form', {}, { mode: 'build' });
    check(after.style === 'stepwise' && after.matched.some(m => m.from === 'Priya'), `a Build-mode prompt matching her rule now gets her style (${before.style} → ${after.style})`);
    rb.undoImport();
    check(fs.readFileSync(rb.file, 'utf8') === fileBefore, 'undo restores profile.json exactly');
    let err = null; try { rb.importStyle({ ...style, features: style.features.slice(1) }, 'Priya'); } catch (e) { err = e; }
    check(err && /features/.test(err.message) && fs.readFileSync(rb.file, 'utf8') === fileBefore, 'a style file with different features is rejected');
  });

  await scenario(15, 'Privacy and the manager view across all three projects', async check => {
    // P2: Meera creates it, Asha joins and records a decision, Meera supersedes it
    const m2 = ctx('meera', 'p2'), a2 = ctx('asha', 'p2');
    chatLocally(m2, 'DistilBERT is worth it if you have a GPU.');
    await m2.tm.setup();
    await m2.ops.setPlan([{ name: 'data', tasks: ['Collect reviews'] }, { name: 'model', tasks: ['Baseline', 'Fine-tune'] }], 'data');
    await m2.tm.publish();
    await a2.tm.setup(); await a2.ops.sync();
    now.advance(20 * MIN);
    await a2.ops.recordDecision('Use a TF-IDF + logistic regression baseline', 'Fast to train and easy to explain.', [], 'model');
    await a2.tm.publish();
    await m2.tm.pull();
    now.advance(HOUR);
    const newer = await m2.ops.recordDecision('Use DistilBERT', 'Fine-tuned DistilBERT reaches 0.86 F1.', [], 'model');
    const old = (await m2.tm.state()).fold.decisions.find(d => d.title.startsWith('Use a TF-IDF'));
    await m2.ops.supersedeDecision(old.id, newer.teamId, 'The baseline plateaued at 0.71 F1');
    await m2.tm.publish();
    // P3 activity from everyone
    for (const k of ['meera', 'asha', 'priya', 'tom']) { const c = ctx(k, 'p3'); await c.tm.pull(); chatLocally(c, 'ok'); }
    const m3 = ctx('meera', 'p3');
    const st3 = await m3.tm.state();
    await m3.ops.claim(phaseOf(st3, 'ui').id, taskOf(st3, 'ui', 'Message list').id);
    await m3.tm.publish();
    // Tom never published on P2: he can still read everything
    const t2 = ctx('tom', 'p2');
    await t2.tm.setup();
    const st = await t2.tm.pull();
    const md = fs.readFileSync(path.join(t2.root, '.vyuha', 'team', 'TEAM.md'), 'utf8');
    const sup = st.fold.decisions.find(d => d.id === old.id);
    check(sup.status === 'superseded' && sup.supersededByPerson === ID('meera') && /0\.71/.test(sup.reason), 'Meera superseded Asha\u2019s decision; the fold keeps who and why');
    check(/~~Use a TF-IDF \+ logistic regression baseline \(model\)~~: superseded by "Use DistilBERT" \(Meera\): The baseline plateaued at 0\.71 F1/.test(md), 'TEAM.md shows it struck through, with the reason');
    check(!remoteHas('p2', `people/${ID('tom')}/profile.json`) && st.fold.phases.length === 2 && md.includes('## Overview'), 'Tom never published on P2 and still reads the full fold and TEAM.md');
    // scan every file on every vyuha_context branch
    const bad = [];
    let scanned = 0;
    const forbidden = [
      ...Object.values(PROMPTS).map(s => ['prompt', s]), ['prompt marker', 'PROMPT-'], ['fake GitHub token', FAKE_TOKEN], ['token prefix', 'ghp_'],
      ['transcript', /transcript/i], ['chat history', /"history"\s*:/], ['signals', /signals/i], ['typing data', /"typing_speed"\s*:|"backspace"\s*:|"pauses"\s*:/], ['typing feature names', /typing_speed|pauses_z|backspace_z/],
      ['state', /"(energy|clarity|satisfaction)"\s*:|late_night"\s*:\s*\d/], ['API key', /AIza[\w-]{20,}/]];
    for (const proj of ['p1', 'p2', 'p3']) {
      for (const f of H.branchFiles(remotes[proj], T.BRANCH)) {
        scanned++;
        for (const [what, pat] of forbidden) if (typeof pat === 'string' ? f.content.includes(pat) : pat.test(f.content)) bad.push(`${proj}:${f.path} contains ${what}`);
      }
    }
    if (bad.length) console.log('  found:', bad.join('; '));
    check(!bad.length, `scanned ${scanned} files on 3 vyuha_context branches: no prompts, transcript, history, signals, typing data or tokens`);
    check(remoteFile('p1', `people/${ID('priya')}/issues.json`).includes('[redacted]'), `the injected ${FAKE_TOKEN.slice(0, 8)}… token appears only as [redacted]`);
  });

  await scenario(16, 'Regression: no team context behaves exactly as before', async check => {
    const repo = path.resolve(__dirname, '..');
    const base = execFileSync('git', ['merge-base', 'HEAD', 'main'], { cwd: repo, encoding: 'utf8' }).trim();
    const oldDir = path.join(H.tmpRoot, 'base-code');
    execFileSync('git', ['worktree', 'add', '-f', '--detach', oldDir, base], { cwd: repo, stdio: 'ignore' });
    try {
      fs.symlinkSync(path.join(repo, 'node_modules'), path.join(oldDir, 'node_modules'), 'junction');
      const Old = { Store: require(path.join(oldDir, 'src', 'store')).Store, agent: require(path.join(oldDir, 'src', 'agent')) };
      // two identical folders, one driven by the old code, one by the new code paths main.js uses
      const make = (name, StoreClass) => {
        const root = path.join(H.tmpRoot, 'regress', name, 'proj');
        fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'train.py'), 'print(1)\n');
        const sdir = path.join(H.tmpRoot, 'regress', name, 'vyuha'); fs.mkdirSync(sdir, { recursive: true }); fs.writeFileSync(path.join(sdir, 'README'), 'x');
        const s = new StoreClass(path.join(sdir, 'projects'), path.join(sdir, 'folders.json'));
        return { root, s, pid: s.openFolder(root) };
      };
      const O = make('old', Old.Store), N = make('new', Store);
      const plan = [{ name: 'Get the data', goal: 'Have a clean dataset', tasks: ['Find a dataset', 'Clean it'] }, { name: 'Model', goal: 'A baseline', tasks: ['Train'] }];
      // old sequence: store calls exactly as main.js made them before team context
      { const { s, pid } = O;
        s.setPlan(pid, plan, 'Get the data');
        s.setPhaseNote(pid, '1-get-the-data', '**Summary**: found SMS spam data.', true);
        s.setTask(pid, '1-get-the-data', { text: 'find a dataset', done: true });
        s.setTask(pid, '1-get-the-data', { index: 1 });
        s.addPhase(pid, 'Deploy'); s.renamePhase(pid, '3-deploy', 'Ship'); s.movePhase(pid, '3-ship', -1); s.deletePhase(pid, '2-ship');
        s.addDecision(pid, 'Use naive Bayes', 'Simple baseline', []); }
      // new sequence: the same operations through planOps (team = null) and the command hooks, as main.js now calls them
      const hookOut = [];
      { const { s, pid, root } = N;
        const ops = tp.planOps(s, pid, T.Team.isEnabled(root) ? new T.Team({ root }) : null);
        await ops.setPlan(plan, 'Get the data');
        await ops.updateNotes('1-get-the-data', '**Summary**: found SMS spam data.', true);
        await ops.updateTask('1-get-the-data', 'find a dataset', true);
        await ops.toggleTask('1-get-the-data', 1);
        await ops.addPhase('Deploy'); await ops.renamePhase('3-deploy', 'Ship'); await ops.movePhase('3-ship', -1); await ops.deletePhase('2-ship');
        await ops.recordDecision('Use naive Bayes', 'Simple baseline', []);
        const tm = T.Team.isEnabled(root) ? new T.Team({ root }) : null;
        for (const [code, output] of [[1, 'Error: boom'], [0, 'ok']]) {
          hookOut.push((await T.geminiCommandHook(tm, { command: 'python train.py', result: { code, output } })).fields);
          hookOut.push(await T.terminalCommandHook(tm, { command: 'python train.py', result: { code, output }, notify: () => hookOut.push('event!') }));
        } }
      const norm = p => JSON.stringify({ ...p, id: '', decisions: p.decisions.map(d => ({ ...d, time: '' })), events: p.events.map(e => ({ ...e, id: '', time: '' })) });
      const po = O.s.get(O.pid), pn = N.s.get(N.pid);
      check(norm(po) === norm(pn), `project.json identical apart from timestamps and ids (phases: ${pn.phases.join(', ')})`);
      check(JSON.stringify(po.phaseNotes) === JSON.stringify(pn.phaseNotes), 'phaseNotes text identical');
      check(!fs.existsSync(path.join(N.root, '.vyuha', 'team')) && !fs.existsSync(path.join(N.root, '.vyuha', 'team-local')), 'no .vyuha/team or .vyuha/team-local folder was created');
      check(JSON.stringify(agent.TOOLS) === JSON.stringify(Old.agent.TOOLS) &&
        agent.systemPrompt(N.s.full(N.pid), [], [], 'teach', '', '') === Old.agent.systemPrompt(N.s.full(N.pid), [], [], 'teach', ''), 'the tool list and system prompt sent to Gemini are identical');
      check(JSON.stringify(hookOut) === JSON.stringify([{}, null, {}, null]) && !fs.existsSync(path.join(N.root, '.vyuha', 'team-local', 'issues.json')), 'failing and passing commands through both handlers: no tool-result fields, no UI events, no issue records');
    } finally {
      try { fs.unlinkSync(path.join(oldDir, 'node_modules')); } catch (e) { /* ignore */ }
      execFileSync('git', ['worktree', 'remove', '--force', oldDir], { cwd: repo, stdio: 'ignore' });
    }
  });

  await scenario(17, 'No data loss: re-clone and one person on two machines', async check => {
    const mine = () => remoteFile('p1', `people/${ID('priya')}/events.jsonl`).trim().split('\n').map(l => JSON.parse(l));
    const p = ctx('priya', 'p1');
    await p.tm.pull(); await p.ops.sync();
    now.advance(5 * MIN);
    await p.ops.recordDecision('Store sessions in Redis', 'Sessions survive API restarts.', [], 'auth');
    await p.tm.publish();
    const before = mine();
    const beforeIssues = JSON.parse(remoteFile('p1', `people/${ID('priya')}/issues.json`));
    const kinds = new Set(before.map(e => e.type));
    assert.ok(['task_claimed', 'task_done', 'decision_recorded'].every(t => kinds.has(t)) && beforeIssues.length === 1, 'Priya has claims, ticks, a decision and an issue on the branch');
    // her laptop is wiped: clone and .vyuha gone
    fs.rmSync(p.root, { recursive: true, force: true });
    delete ctxs['priya:p1'];
    const p2 = ctx('priya', 'p1', 'shop-web-reclone');
    assert.ok(!fs.existsSync(path.join(p2.root, '.vyuha', 'team-local')) && !fs.existsSync(path.join(p2.root, '.vyuha', 'team')), 'fresh clone: no team-local log, no worktree');
    await p2.tm.setup();
    check(p2.tm.localEvents().length === before.length && p2.tm.localIssues().length === 1, `after re-clone + setup, her ${before.length} events and 1 issue are back in team-local`);
    now.advance(MIN);
    const st0 = await p2.tm.state();
    await p2.tm.emit('task_added', { phaseId: phaseOf(st0, 'backend').id, taskId: 't-after-reclone', text: 'Rate limiting' });
    await p2.tm.publish();
    const after = mine();
    const afterIssues = JSON.parse(remoteFile('p1', `people/${ID('priya')}/issues.json`));
    check(before.every(e => after.some(x => x.id === e.id)) && after.length === before.length + 1, `publishing from the fresh clone keeps all ${before.length} earlier events and adds 1 (${after.length} on the branch)`);
    check(afterIssues.length === 1 && afterIssues[0].id === beforeIssues[0].id && afterIssues[0].cause === beforeIssues[0].cause, 'her published issue card is still on the branch, edited cause intact');
    const st = await ctx('tom', 'p1').tm.pull();
    check(taskOf(st, 'backend', 'Connect login API').done && taskOf(st, 'backend', 'Rate limiting') && st.fold.decisions.some(d => d.title === 'Store sessions in Redis' && d.by === ID('priya')) && st.issues.some(i => i.id === beforeIssues[0].id),
      'the fold still has her ticks, decision and issue, plus the new task');
    // the same person on two clones, publishing alternately
    const b = ctx('priya', 'p1', 'shop-web-laptop2');
    await b.tm.setup();
    const ids = [];
    for (const [who, text] of [[p2, 'Audit log'], [b, 'Password reset'], [p2, 'Lockout after 5 tries'], [b, 'Remember me']]) {
      now.advance(MIN);
      const sx = await who.tm.state();
      const r = await who.tm.emit('task_added', { phaseId: phaseOf(sx, 'backend').id, taskId: 't-' + text.replace(/\W+/g, '-').toLowerCase(), text });
      ids.push(r.event.id);
      await who.tm.publish();
    }
    const final = mine();
    check(ids.every(id => final.some(e => e.id === id)) && before.every(e => final.some(x => x.id === e.id)) && final.length === after.length + 4,
      `two clones publishing alternately lose nothing (${final.length} events = ${after.length} + 4)`);
    await p2.tm.pull(); await b.tm.pull();
    const fa = await p2.tm.state(), fb = await b.tm.state();
    check(JSON.stringify(fa.fold.phases) === JSON.stringify(fb.fold.phases) && phaseOf(fa, 'backend').tasks.length === 7, 'both clones fold to the same plan (backend has 7 tasks)');
  });

  /* ---------- report ---------- */
  console.log('\n| # | Scenario | Result | Key assertion |\n|---|---|---|---|');
  for (const r of results) console.log(`| ${r.n} | ${r.title} | ${r.ok ? 'PASS' : 'FAIL'} | ${String(r.key).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
  if (failed.length) process.exit(1);
  console.log('all team simulation checks passed');
})().catch(e => { console.error(e); process.exit(1); });
