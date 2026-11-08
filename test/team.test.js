// Team context: event model and fold rules. Run: node test/team.test.js
const assert = require('assert');
const team = require('../src/team');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
let clock = Date.parse('2026-11-08T09:00:00Z');
const tick = (min = 1) => { clock += min * 60e3; return clock; };
let n = 0;
const ev = (by, type, payload = {}) => {
  tick();
  const at = new Date(clock).toISOString();
  return { id: `${at}-${by}-${(n++).toString(16).padStart(4, '0')}`, at, by, type, ...payload };
};
const T = { version: 1, project: 'shop', createdBy: 'asha', createdAt: '2026-11-08T08:00:00Z', takeoverAfterMinutes: 120 };
const byPerson = list => { const o = {}; for (const e of list) (o[e.by] = o[e.by] || []).push(e); return o; };
const F = list => team.fold(T, byPerson(list));
const rejectedOf = (f, e) => f.rejected.find(r => r.event.id === e.id);

// ids
{
  const e = team.makeEvent('phase_started', { phaseId: 'p1' }, { by: 'asha', now: () => Date.parse('2026-11-08T10:00:00Z'), random: () => 0.5 });
  ok(/^2026-11-08T10:00:00\.000Z-asha-[0-9a-f]{4}$/.test(e.id) && e.at === '2026-11-08T10:00:00.000Z' && e.by === 'asha', `event id is <iso>-<person>-<rand4>: ${e.id}`);
  ok(team.slugId('Priya.K@Example.com') === 'priya-k-example-com', 'person id is a slug of the email');
}

const base = [
  ev('asha', 'phase_created', { phaseId: 'plan', name: 'planning', plannedBy: 'asha' }),
  ev('asha', 'phase_created', { phaseId: 'be', name: 'backend', plannedBy: 'asha' }),
  ev('asha', 'phase_created', { phaseId: 'fe', name: 'frontend', plannedBy: 'asha' }),
  ev('asha', 'task_added', { phaseId: 'be', taskId: 'be1', text: 'Connect login API' }),
  ev('asha', 'task_added', { phaseId: 'be', taskId: 'be2', text: 'Session store' }),
  ev('asha', 'task_added', { phaseId: 'fe', taskId: 'fe1', text: 'Build login page' })
];

// phase_created: unowned, plannedBy
{
  const f = F(base);
  ok(f.phases.length === 3 && f.phases.every(p => p.owner === null && p.plannedBy === 'asha'), 'phase_created: phases start unowned, plannedBy recorded');
  ok(f.phases.map(p => p.name).join() === 'planning,backend,frontend', 'phase order is creation order');
  const dup = ev('priya', 'phase_created', { phaseId: 'be', name: 'dup' });
  ok(rejectedOf(F([...base, dup]), dup), 'phase_created with an existing id is rejected');
}

// phase_started
{
  const s1 = ev('asha', 'phase_started', { phaseId: 'plan' });
  const s2 = ev('priya', 'phase_started', { phaseId: 'plan' });
  const f = F([...base, s1, s2]);
  ok(f.phases[0].owner === 'asha', 'phase_started on an unowned phase sets the owner');
  ok(rejectedOf(f, s2) && /already owned/.test(rejectedOf(f, s2).reason), 'phase_started on an owned phase has no effect (rejected with reason)');
}

// task_claimed / task_done / task_reopened / task_assigned / task_added
{
  const c = ev('priya', 'task_claimed', { phaseId: 'be', taskId: 'be1' });
  const c2 = ev('ravi', 'task_claimed', { phaseId: 'be', taskId: 'be2' });
  const d = ev('ravi', 'task_done', { phaseId: 'fe', taskId: 'fe1' });
  let f = F([...base, c, c2, d]);
  const be = f.phases.find(p => p.id === 'be'), fe = f.phases.find(p => p.id === 'fe');
  ok(be.owner === 'priya' && be.tasks[0].assignee === 'priya', 'task_claimed sets assignee and owns an unowned phase');
  ok(be.tasks[1].assignee === 'ravi' && be.owner === 'priya', 'claiming in an owned phase assigns but does not change the owner');
  ok(fe.owner === 'ravi' && fe.tasks[0].done && fe.tasks[0].doneBy === 'ravi', 'task_done ticks the task and owns an unowned phase');
  const r = ev('asha', 'task_reopened', { phaseId: 'fe', taskId: 'fe1' });
  f = F([...base, c, c2, d, r]);
  ok(!f.phases.find(p => p.id === 'fe').tasks[0].done && f.phases.find(p => p.id === 'fe').owner === 'ravi', 'task_reopened unticks; ownership unchanged');
  const a1 = ev('ravi', 'task_assigned', { phaseId: 'be', taskId: 'be2', to: 'priya' });
  const a2 = ev('asha', 'task_assigned', { phaseId: 'be', taskId: 'be2', to: 'tom' });
  f = F([...base, c, c2, a1, a2]);
  ok(f.phases.find(p => p.id === 'be').tasks[1].assignee === 'tom', 'task_assigned: the latest assignment wins');
  const add = ev('tom', 'task_added', { phaseId: 'fe', taskId: 'fe2', text: 'Accessibility check' });
  const addBad = ev('tom', 'task_added', { phaseId: 'nope', taskId: 'x', text: 'x' });
  f = F([...base, add, addBad]);
  ok(f.phases.find(p => p.id === 'fe').tasks.length === 2 && rejectedOf(f, addBad), 'task_added: anyone into an existing phase; unknown phase rejected');
  const missing = ev('tom', 'task_done', { phaseId: 'fe', taskId: 'zz' });
  ok(rejectedOf(F([...base, missing]), missing).reason === 'unknown task', 'ticking an unknown task is rejected');
}

// owner-only task edits
{
  const s = ev('priya', 'phase_started', { phaseId: 'be' });
  const rn = ev('ravi', 'task_renamed', { phaseId: 'be', taskId: 'be1', text: 'hijacked' });
  const rnOk = ev('priya', 'task_renamed', { phaseId: 'be', taskId: 'be1', text: 'Connect login API v2' });
  const rm = ev('ravi', 'task_removed', { phaseId: 'be', taskId: 'be2' });
  const rmOk = ev('priya', 'task_removed', { phaseId: 'be', taskId: 'be2' });
  const ro = ev('priya', 'task_reordered', { phaseId: 'be', order: ['be2', 'be1'] });
  let f = F([...base, s, rn, rnOk, rm]);
  const be = () => f.phases.find(p => p.id === 'be');
  ok(rejectedOf(f, rn) && be().tasks[0].text === 'Connect login API v2', 'task_renamed: owner only');
  ok(rejectedOf(f, rm) && be().tasks.length === 2, 'task_removed by a non-owner is rejected');
  f = F([...base, s, ro]);
  ok(be().tasks.map(t => t.id).join() === 'be2,be1', 'task_reordered by the owner reorders');
  f = F([...base, s, rmOk]);
  ok(be().tasks.length === 1 && be().progress.total === 1, 'task_removed by the owner removes it (and it leaves progress)');
  const unowned = ev('asha', 'task_renamed', { phaseId: 'fe', taskId: 'fe1', text: 'x' });
  ok(/no owner/.test(rejectedOf(F([...base, unowned]), unowned).reason), 'task edits in an unowned phase are rejected with a reason');
}

// phase_renamed / phase_removed: owner only
{
  const s = ev('priya', 'phase_started', { phaseId: 'be' });
  const rn = ev('ravi', 'phase_renamed', { phaseId: 'be', name: 'ravi-backend' });
  const rnOk = ev('priya', 'phase_renamed', { phaseId: 'be', name: 'api' });
  const rm = ev('asha', 'phase_removed', { phaseId: 'be' });
  let f = F([...base, s, rn]);
  ok(rejectedOf(f, rn) && f.phases[1].name === 'backend', 'phase_renamed by a non-owner is rejected; name unchanged');
  f = F([...base, s, rnOk, rm]);
  ok(f.phases[1].name === 'api' && rejectedOf(f, rm), 'phase_renamed by the owner works; even the creator cannot remove someone else’s phase');
  const rmOk = ev('priya', 'phase_removed', { phaseId: 'be' });
  const after = ev('ravi', 'task_claimed', { phaseId: 'be', taskId: 'be1' });
  f = F([...base, s, rmOk, after]);
  ok(f.phases.length === 2 && /removed/.test(rejectedOf(f, after).reason), 'phase_removed by the owner removes it; later events on it are rejected');
}

// phase_reordered: creator only
{
  const bad = ev('priya', 'phase_reordered', { order: ['fe', 'be', 'plan'] });
  const good = ev('asha', 'phase_reordered', { order: ['fe', 'be', 'plan'] });
  let f = F([...base, bad]);
  ok(rejectedOf(f, bad) && f.phases.map(p => p.id).join() === 'plan,be,fe', 'phase_reordered by a non-creator is rejected');
  f = F([...base, bad, good]);
  ok(f.phases.map(p => p.id).join() === 'fe,be,plan', 'phase_reordered by the creator changes the order');
  const late = ev('asha', 'phase_created', { phaseId: 'qa', name: 'testing' });
  f = F([...base, good, late]);
  ok(f.phases.map(p => p.id).join() === 'fe,be,plan,qa', 'phases created after a reorder go to the end');
}

// handoff / takeover / takeback
{
  const s = ev('priya', 'phase_started', { phaseId: 'be' });
  const ho = ev('ravi', 'phase_handoff', { phaseId: 'be', to: 'ravi' });
  const hoOk = ev('priya', 'phase_handoff', { phaseId: 'be', to: 'meera' });
  let f = F([...base, s, ho, hoOk]);
  ok(rejectedOf(f, ho) && f.phases[1].owner === 'meera', 'phase_handoff: only the current owner');
  ok(f.ownershipLog.some(l => l.action === 'handed off' && l.from === 'priya' && l.to === 'meera'), 'ownershipLog records the handoff');

  const early = ev('tom', 'phase_takeover', { phaseId: 'be' });   // one minute after Priya's start
  clock += 3 * 3600e3;
  const late = ev('tom', 'phase_takeover', { phaseId: 'be' });
  const backRavi = ev('ravi', 'phase_takeback', { phaseId: 'be' });
  const backPriya = ev('priya', 'phase_takeback', { phaseId: 'be' });
  f = F([...base, s, early, late, backRavi, backPriya]);
  ok(/active \d+ min ago/.test(rejectedOf(f, early).reason), `takeover while the owner is active is rejected: "${rejectedOf(f, early).reason}"`);
  ok(f.ownershipLog.some(l => l.action === 'took over' && l.takenFrom === 'priya' && l.to === 'tom'), 'takeover after the idle limit is accepted and records who it was taken from');
  ok(rejectedOf(f, backRavi), 'takeback by someone else is rejected');
  ok(f.phases[1].owner === 'priya' && f.ownershipLog.some(l => l.action === 'took back' && l.to === 'priya'), 'the person it was taken from can take it back');
  ok(team.takeoverBlocked(F([...base, s]), 'be', 'tom', Date.parse(s.at) + 30 * 60e3).includes('30 min ago'), 'takeoverBlocked explains why the button is disabled');
  ok(team.takeoverBlocked(F([...base, s]), 'be', 'tom', Date.parse(s.at) + 3 * 3600e3) === null, 'takeoverBlocked allows it after the limit');
  const noOwner = ev('tom', 'phase_takeover', { phaseId: 'fe' });
  ok(/no owner/.test(rejectedOf(F([...base, noOwner]), noOwner).reason), 'takeover of an unowned phase is rejected');
}

// decisions
{
  const d1 = ev('asha', 'decision_recorded', { decisionId: 'd1', area: 'auth', title: 'Use JWT', detail: 'stateless', sources: [] });
  const d2 = ev('meera', 'decision_recorded', { decisionId: 'd2', area: 'auth', title: 'Use sessions', detail: 'simpler revocation', sources: [] });
  const sup = ev('meera', 'decision_superseded', { decisionId: 'd1', replacedBy: 'd2', reason: 'revocation matters more' });
  const f = F([d1, d2, sup]);
  ok(f.decisions.length === 2 && f.decisions[0].status === 'superseded' && f.decisions[0].supersededBy === 'd2' && f.decisions[0].supersededByPerson === 'meera', 'decision_superseded keeps history with who and why');
  ok(f.decisions[1].status === 'current' && f.decisions[1].area === 'auth', 'the new decision is current');
}

// forged events, sorting, members, progress, lastActivity
{
  const forged = { ...ev('asha', 'phase_renamed', { phaseId: 'be', name: 'x' }) };
  const f = team.fold(T, { ...byPerson(base), ravi: [forged] }, { asha: { name: 'Asha' }, ravi: { name: 'Ravi' } });
  ok(f.rejected.some(r => r.event.id === forged.id && /another person/.test(r.reason)), 'an event in someone else’s folder is rejected');
  ok(f.members.some(m => m.id === 'asha' && m.name === 'Asha') && f.members.some(m => m.id === 'ravi'), 'members come from profiles and folders');
  const shuffled = byPerson([...base].reverse());
  ok(JSON.stringify(team.fold(T, shuffled).phases) === JSON.stringify(F(base).phases), 'the fold is independent of file order (sorted by at, id)');
  const t1 = ev('ravi', 'task_done', { phaseId: 'be', taskId: 'be1' });
  const t2 = ev('priya', 'task_done', { phaseId: 'be', taskId: 'be2' });
  const g = F([...base, t1, t2]);
  ok(g.phases[1].progress.done === 2 && g.phases[1].progress.total === 2 && g.lastActivity.priya === t2.at, 'progress counts done/total per phase; lastActivity tracks each person');
  const bad = ev('tom', 'what_is_this', {});
  ok(/unknown event type/.test(rejectedOf(F([bad]), bad).reason), 'unknown event types are rejected');
}

console.log('all team fold checks passed');
