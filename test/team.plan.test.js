// Team context plan integration: store ↔ team events. Run: node test/team.plan.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Store } = require('../src/store');
const { Team } = require('../src/team');
const tp = require('../src/team-plan');
const agent = require('../src/agent');
const H = require('./team-helpers');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
const now = H.clock('2026-11-08T09:00:00Z');
const asha = { id: 'asha-example-com', name: 'Asha', email: 'asha@example.com' };
const priya = { id: 'priya-example-com', name: 'Priya', email: 'priya@example.com' };

function storeFor(root, name) {
  const dir = path.join(H.tmpRoot, 'stores', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README'), 'x');   // non-empty: skip the seed projects
  const s = new Store(path.join(dir, 'projects-' + name), path.join(dir, 'folders.json'));
  return { s, pid: s.openFolder(root) };
}

(async () => {
  // syncNotes only touches team lines
  {
    const notes = 'Goal: ship login.\n\n- [ ] my own local task\n- [ ] old <!--vt:t-old-->\n\n**Earlier notes**\n\nkeep me';
    const out = tp.syncNotes(notes, [{ id: 't-a', text: 'Build page', done: true }, { id: 't-b', text: 'Tests', done: false }]);
    ok(out.startsWith('Goal: ship login.\n\n- [ ] my own local task') && out.includes('**Earlier notes**\n\nkeep me'), 'syncNotes keeps goal, local tasks and earlier notes exactly');
    ok(!out.includes('t-old') && out.includes('- [x] Build page <!--vt:t-a-->') && out.includes('- [ ] Tests <!--vt:t-b-->'), 'syncNotes removes stale team lines and adds/updates team tasks');
    ok(tp.syncNotes(out, [{ id: 't-a', text: 'Build page', done: true }, { id: 't-b', text: 'Tests', done: false }]) === out, 'syncNotes is idempotent');
  }

  // no team: planOps calls the store exactly
  {
    const bare = H.makeRemote('plan-local');
    const root = H.cloneFor(bare, asha, 'plan-local');
    const { s, pid } = storeFor(root, 'local');
    const ops = tp.planOps(s, pid, null);
    ok(ops.team === null, 'without team context planOps is the plain store');
    const order = ops.setPlan([{ name: 'Data', goal: 'Have data', tasks: ['Find', 'Clean'] }, { name: 'Model', tasks: ['Train'] }], 'Data');
    ok(order.join() === '1-data,2-model' && s.get(pid).phaseNotes['1-data'].startsWith('Have data'), 'setPlan works as before');
    ops.toggleTask('1-data', 0);
    ok(/- \[x\] Find/.test(s.get(pid).phaseNotes['1-data']), 'toggleTask works as before');
    ok(!fs.existsSync(path.join(root, '.vyuha', 'team')) && !fs.existsSync(path.join(root, '.vyuha', 'team-local')), 'no team folders are created');
    ok(JSON.stringify(agent.TOOLS) === JSON.stringify(agent.TOOLS) && !agent.TOOLS[0].functionDeclarations.some(d => d.name === 'claim_task'), 'TOOLS has no claim_task');
    ok(agent.teamTools()[0].functionDeclarations.some(d => d.name === 'claim_task') && agent.teamTools()[0].functionDeclarations.find(d => d.name === 'record_decision').parameters.properties.area, 'teamTools adds claim_task and a decision area');
  }

  // with team context
  const bare = H.makeRemote('plan-team');
  const ra = H.cloneFor(bare, asha, 'plan-team');
  const rp = H.cloneFor(bare, priya, 'plan-team');
  const A = new Team({ root: ra, project: 'plan-team', now, random: H.rng(3) });
  const P = new Team({ root: rp, project: 'plan-team', now, random: H.rng(4) });
  const sa = storeFor(ra, 'asha'), sp = storeFor(rp, 'priya');
  // Asha already has a local plan with a goal and a ticked task: it is imported when she creates the context
  sa.s.setPlan(sa.pid, [{ name: 'Planning', goal: 'Agree scope', tasks: ['Write brief'], done: ['Write brief'] }], 'Planning');
  const created = await A.setup();
  ok(created.created && await tp.importLocalPlan(sa.s, sa.pid, A) === 1, 'the creator’s existing plan is imported into the team plan');
  let st = await A.state();
  ok(st.fold.phases[0].name === 'planning' && st.fold.phases[0].tasks[0].done, 'imported phase and ticked task are in the fold');
  ok(sa.s.get(sa.pid).phaseNotes['1-planning'].startsWith('Agree scope') && (sa.s.get(sa.pid).phaseNotes['1-planning'].match(/Write brief/g) || []).length === 1, 'import marks the existing line in place (no duplicate, goal kept)');

  const OA = tp.planOps(sa.s, sa.pid, A);
  await OA.setPlan([{ name: 'Planning', tasks: ['Write brief'] }, { name: 'Backend', goal: 'API works', tasks: ['Connect login API', 'Session store'] }, { name: 'Frontend', tasks: ['Build login page'] }], 'Planning');
  st = await A.state();
  ok(st.fold.phases.map(p => p.name).join() === 'planning,Backend,Frontend', 'set_plan creates phase_created events for new phases only');
  ok(st.fold.phases[0].owner === asha.id && !st.fold.phases[1].owner && st.fold.phases[1].plannedBy === asha.id, 'set_plan starts the current phase; new phases are unowned, plannedBy me');
  const p = sa.s.get(sa.pid);
  ok(p.phases.join() === '1-planning,2-backend,3-frontend' && p.phaseNotes['2-backend'].startsWith('API works'), 'local phases and goals follow the team plan');
  await OA.updateNotes('2-backend', '**Summary**: endpoints drafted.', true);
  await OA.updateTask('2-backend', 'session store', true);
  st = await A.state();
  ok(st.fold.phases[1].tasks.find(t => t.text === 'Session store').done && st.fold.phases[1].owner === asha.id, 'update_task emits task_done (and owns the unowned phase)');
  await OA.toggleTask('2-backend', 0);
  st = await A.state();
  ok(st.fold.phases[1].tasks[0].done, 'checklist toggle maps the index to the task id');
  await A.publish();

  // Priya joins; her default local phases are replaced by the team plan
  await P.setup();
  const OP = tp.planOps(sp.s, sp.pid, P);
  await OP.sync();
  ok(sp.s.get(sp.pid).phases.join() === '1-planning,2-backend,3-frontend', 'a joining member’s empty default phases are replaced by the team plan');
  await OP.claimTask('Frontend', 'Build login page');
  let rejected = null;
  try { await OP.renamePhase('2-backend', 'hijack'); } catch (e) { rejected = e; }
  ok(rejected instanceof tp.Rejected && /only Asha/.test(rejected.message), `renaming someone else’s phase is rejected: "${rejected && rejected.message}"`);
  ok(sp.s.get(sp.pid).phases.includes('2-backend'), '…and the local name is unchanged');
  await P.publish();

  // a pull that changes tasks keeps goal text and update_notes summaries
  await A.pull();
  await OA.sync();
  const notes = sa.s.get(sa.pid).phaseNotes['2-backend'];
  ok(notes.startsWith('API works') && notes.includes('**Summary**: endpoints drafted.'), 'after a pull, goal text and update_notes summary are still in phaseNotes');
  const fe = sa.s.get(sa.pid).phaseNotes['3-frontend'];
  ok(/Build login page <!--vt:/.test(fe), 'teammates’ tasks appear as checklist lines');
  await P.emit('task_added', { phaseId: st.fold.phases[1].id, taskId: 't-new1', text: 'Rate limiting' });
  await P.publish();
  await A.pull(); await OA.sync();
  const notes2 = sa.s.get(sa.pid).phaseNotes['2-backend'];
  ok(notes2.includes('Rate limiting') && notes2.startsWith('API works') && notes2.includes('**Summary**: endpoints drafted.'), 'a pull that adds a task keeps every non-task line');

  // system prompt team section
  const sec = tp.teamPromptSection(await A.state());
  ok(sec.length <= 3000 && /Phase owners: .*Backend: Asha/.test(sec) && /claim_task/.test(sec), 'the Team section lists owners and asks Gemini to claim tasks');
  const sp1 = agent.systemPrompt({ id: 'x', summary: '', phase: '1', phases: ['1'], phaseNotes: { 1: '- [ ] a <!--vt:t-1-->' }, events: [], decisions: [] }, [], [], 'teach', '', sec);
  ok(sp1.includes('Team (this project') && !sp1.includes('<!--vt:'), 'the Team section reaches the system prompt; markers are stripped');
  ok(agent.systemPrompt({ id: 'x', summary: '', phase: '1', phases: ['1'], events: [], decisions: [] }, [], [], 'teach', '') ===
     agent.systemPrompt({ id: 'x', summary: '', phase: '1', phases: ['1'], events: [], decisions: [] }, [], [], 'teach', '', ''), 'no team section: the prompt is unchanged');

  console.log('all team plan checks passed');
})().catch(e => { console.error(e); process.exit(1); });
