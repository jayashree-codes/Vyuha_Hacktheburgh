// Bridge between the project store (phases + phaseNotes checklists) and team context.
//
// planOps(store, pid, team) gives the plan operations Vyuha uses (set_plan, update_task, the checklist
// toggle, phase add/rename/move/delete, record_decision, claim_task…). With team = null every operation
// calls the store exactly as before team context existed. With a Team, operations become events, and the
// local phases and checklists are regenerated from the folded team plan.
//
// Team tasks appear in phaseNotes as ordinary checklist lines with a hidden marker: "- [ ] text <!--vt:t-1a2b3c4d-->".
// Only those lines are ever added, updated or removed by a sync; every other line is left exactly as it is.
const team = require('./team');
const { slug } = require('./store');

const TASK = /^(\s*[-*]\s+)\[( |x|X)\]\s*(.*)$/;
const MARK = /\s*<!--vt:([\w-]+)-->\s*$/;
const bare = ph => String(ph).replace(/^\d+-/, '');
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const lineFor = (t, prefix = '- ') => `${prefix}[${t.done ? 'x' : ' '}] ${t.text} <!--vt:${t.id}-->`;
const markerOf = line => { const m = String(line).match(MARK); return m && TASK.test(line) ? m[1] : null; };
const stripMarkers = s => String(s || '').replace(/\s*<!--vt:[\w-]+-->/g, '');

// Update only the team task lines of one phase's notes
function syncNotes(notes, tasks) {
  const text = String(notes || '');
  let lines = text ? text.split('\n') : [];
  const want = new Map(tasks.map(t => [t.id, t]));
  // drop lines of tasks that are no longer in the team plan, update the others in place
  lines = lines.filter(l => { const id = markerOf(l); return !id || want.has(id); })
    .map(l => { const id = markerOf(l); if (!id) return l; const m = l.match(TASK); return lineFor(want.get(id), m[1]); });
  const at = id => lines.findIndex(l => markerOf(l) === id);
  tasks.forEach((t, i) => {
    if (at(t.id) >= 0) return;
    let pos = -1;
    for (let j = i - 1; j >= 0 && pos < 0; j--) { const k = at(tasks[j].id); if (k >= 0) pos = k + 1; }
    if (pos < 0) for (let j = i + 1; j < tasks.length && pos < 0; j++) { const k = at(tasks[j].id); if (k >= 0) pos = k; }
    if (pos < 0) { let last = -1; lines.forEach((l, k) => { if (TASK.test(l)) last = k; }); if (last >= 0) pos = last + 1; }
    if (pos < 0) {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length) lines.push('');
      pos = lines.length;
    }
    lines.splice(pos, 0, lineFor(t));
  });
  return lines.join('\n');
}

// A plan is "pristine" when it's still the default phases with nothing written in them
function isPristine(p) {
  const empty = v => !String(v || '').trim() || String(v).trim() === 'Project created.';
  return (p.phases || []).every(ph => empty((p.phaseNotes || {})[ph])) && (p.phases || []).length <= 3;
}

function phaseIdOf(p, local) {
  const map = (p.team && p.team.phaseMap) || {};
  return Object.keys(map).find(id => map[id] === local) || null;
}
function findTask(ph, text) {
  const want = norm(text);
  if (!want) return null;
  return ph.tasks.find(t => norm(t.text) === want) || ph.tasks.find(t => norm(t.text).includes(want) || want.includes(norm(t.text))) || null;
}
function findPhase(fold, p, name) {
  if (!name) return null;
  const id = phaseIdOf(p, name) || phaseIdOf(p, (p.phases || []).find(x => bare(x) === bare(slug(name))));
  return fold.phases.find(x => x.id === id) || fold.phases.find(x => slug(x.name) === slug(bare(name))) || null;
}

class Rejected extends Error {}

function planOps(store, pid, tm) {
  const local = {
    team: null,
    setPlan: (phases, current) => store.setPlan(pid, phases, current),
    updateTask: (phase, text, done) => ({ phase: store.setTask(pid, phase, { text, done }) }),
    toggleTask: (phase, index) => ({ phase: store.setTask(pid, phase, { index }) }),
    addPhase: name => store.addPhase(pid, name),
    renamePhase: (phase, name) => store.renamePhase(pid, phase, name),
    movePhase: (phase, dir) => store.movePhase(pid, phase, dir),
    deletePhase: phase => store.deletePhase(pid, phase),
    recordDecision: (title, detail, urls) => store.addDecision(pid, title, detail, urls),
    updateNotes: (phase, note, append) => store.setPhaseNote(pid, phase, note, append)
  };
  if (!tm) return local;

  const sync = async () => { const st = await tm.state(); store.syncTeamPlan(pid, st.fold.phases, syncNotes); return st; };
  const emit = async (type, payload, { quiet = false } = {}) => {
    const r = await tm.emit(type, payload);
    store.syncTeamPlan(pid, r.state.fold.phases, syncNotes);
    if (r.rejected && !quiet) throw new Rejected(r.rejected);
    return r;
  };
  const stateNow = () => tm.state();
  const localName = (st, id) => (store.get(pid).team || { phaseMap: {} }).phaseMap[id] || null;
  const phaseOrThrow = (st, name) => {
    const ph = findPhase(st.fold, store.get(pid), name);
    if (!ph) throw new Error(`Unknown phase ${name}`);
    return ph;
  };

  return {
    team: tm, sync, Rejected,
    async setPlan(phases, current) {
      const list = (phases || []).filter(x => x && x.name).slice(0, 10);
      if (!list.length) throw new Error('A plan needs at least one phase');
      let st = await stateNow();
      const me = st.me.id;
      for (const x of list) {
        let ph = st.fold.phases.find(f => slug(f.name) === slug(x.name));
        if (!ph) {
          const r = await emit('phase_created', { phaseId: team.newPhaseId(tm.random), name: String(x.name).trim(), plannedBy: me }, { quiet: true });
          st = r.state; ph = st.fold.phases.find(f => f.id === r.event.phaseId);
        }
        for (const t of (x.tasks || []).filter(Boolean)) {
          let task = ph.tasks.find(y => norm(y.text) === norm(t));
          if (!task) {
            const r = await emit('task_added', { phaseId: ph.id, taskId: team.newTaskId(tm.random), text: String(t).trim() }, { quiet: true });
            st = r.state; ph = st.fold.phases.find(f => f.id === ph.id); task = ph.tasks.find(y => y.id === r.event.taskId);
          }
          if (x.done && x.done.includes(t) && task && !task.done) { const r = await emit('task_done', { phaseId: ph.id, taskId: task.id }, { quiet: true }); st = r.state; }
        }
      }
      const cur = current && st.fold.phases.find(f => slug(f.name) === slug(String(current).replace(/^\d+-/, '')));
      if (cur && !cur.owner) { const r = await emit('phase_started', { phaseId: cur.id }, { quiet: true }); st = r.state; }
      st = await sync();
      // goals stay local (never overwritten): add one only where the notes don't have it yet
      const p = store.get(pid);
      for (const x of list) {
        const ph = st.fold.phases.find(f => slug(f.name) === slug(x.name));
        const ln = ph && localName(st, ph.id);
        const goal = x.goal && String(x.goal).trim();
        if (!ln || !goal) continue;
        const notes = (p.phaseNotes || {})[ln] || '';
        if (!notes.includes(goal)) store.setPhaseNote(pid, ln, notes.trim() ? `${goal}\n\n${notes}` : goal, false);
      }
      if (cur && localName(st, cur.id)) store.setCurrentPhase(pid, localName(st, cur.id));
      return store.get(pid).phases;
    },
    async updateTask(phase, text, done) {
      const p = store.get(pid);
      const id = phaseIdOf(p, phase);
      if (!id) return local.updateTask(phase, text, done);
      const st = await stateNow();
      const ph = st.fold.phases.find(f => f.id === id);
      if (!ph) return local.updateTask(phase, text, done);
      let task = findTask(ph, text);
      if (!task) {
        const r = await emit('task_added', { phaseId: id, taskId: team.newTaskId(tm.random), text: String(text).trim() });
        task = { id: r.event.taskId, done: false };
      }
      const want = done == null ? !task.done : !!done;
      if (want !== task.done) await emit(want ? 'task_done' : 'task_reopened', { phaseId: id, taskId: task.id });
      return { phase: localName(null, id) || phase, taskId: task.id };
    },
    async toggleTask(phase, index) {
      const p = store.get(pid);
      const lines = String((p.phaseNotes || {})[phase] || '').split('\n');
      let n = -1, line = null;
      for (const l of lines) { if (TASK.test(l)) { n++; if (n === index) { line = l; break; } } }
      const tid = line && markerOf(line);
      const id = phaseIdOf(p, phase);
      if (!tid || !id) return local.toggleTask(phase, index);
      const st = await stateNow();
      const task = (st.fold.phases.find(f => f.id === id) || { tasks: [] }).tasks.find(t => t.id === tid);
      if (!task) throw new Error('Task not found');
      await emit(task.done ? 'task_reopened' : 'task_done', { phaseId: id, taskId: tid });
      return { phase: localName(null, id) || phase, taskId: tid };
    },
    async claimTask(phase, text) {
      const st = await stateNow();
      const p = store.get(pid);
      const ph = phaseOrThrow(st, phase || p.phase);
      let task = findTask(ph, text);
      if (!task) { const r = await emit('task_added', { phaseId: ph.id, taskId: team.newTaskId(tm.random), text: String(text).trim() }); task = { id: r.event.taskId }; }
      const r = await emit('task_claimed', { phaseId: ph.id, taskId: task.id });
      const after = r.state.fold.phases.find(f => f.id === ph.id);
      return { phase: localName(null, ph.id), taskId: task.id, owner: after && after.owner };
    },
    async addPhase(name) {
      if (!slug(name)) throw new Error('A name is needed');
      const st = await stateNow();
      if (st.fold.phases.some(f => slug(f.name) === slug(name))) throw new Error(`There is already a ${slug(name)} phase`);
      const r = await emit('phase_created', { phaseId: team.newPhaseId(tm.random), name: String(name).trim(), plannedBy: st.me.id });
      return localName(null, r.event.phaseId);
    },
    async renamePhase(phase, name) {
      const id = phaseIdOf(store.get(pid), phase);
      if (!id) return local.renamePhase(phase, name);
      if (!slug(name)) throw new Error('A name is needed');
      await emit('phase_renamed', { phaseId: id, name: String(name).trim() });
      return localName(null, id);
    },
    async movePhase(phase, dir) {
      const id = phaseIdOf(store.get(pid), phase);
      if (!id) return local.movePhase(phase, dir);
      const st = await stateNow();
      const ids = st.fold.phases.map(f => f.id);
      const i = ids.indexOf(id), j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= ids.length) return phase;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await emit('phase_reordered', { order: ids });
      return localName(null, id);
    },
    async deletePhase(phase) {
      const id = phaseIdOf(store.get(pid), phase);
      if (!id) return local.deletePhase(phase);
      await emit('phase_removed', { phaseId: id });
    },
    async recordDecision(title, detail, urls, area) {
      const d = store.addDecision(pid, title, detail, urls);
      const p = store.get(pid);
      const r = await emit('decision_recorded', { decisionId: team.newDecisionId(tm.random), phaseId: phaseIdOf(p, p.phase), area: String(area || ''), title, detail: detail || '', sources: urls || [] });
      d.teamId = r.event.decisionId;
      store.save(p);
      return d;
    },
    async supersedeDecision(decisionId, replacedBy, reason) { return emit('decision_superseded', { decisionId, replacedBy: replacedBy || null, reason: reason || '' }); },
    async updateNotes(phase, note, append) { const r = local.updateNotes(phase, note, append); await sync(); return r; },
    // phase page actions
    async startPhase(phaseId) { return emit('phase_started', { phaseId }); },
    async claim(phaseId, taskId) { return emit('task_claimed', { phaseId, taskId }); },
    async assign(phaseId, taskId, to) { return emit('task_assigned', { phaseId, taskId, to }); },
    async handoff(phaseId, to) { return emit('phase_handoff', { phaseId, to }); },
    async takeover(phaseId) { return emit('phase_takeover', { phaseId }); },
    async takeback(phaseId) { return emit('phase_takeback', { phaseId }); }
  };
}

// First publisher: bring the existing local plan into the team plan, marking each existing task line in place
async function importLocalPlan(store, pid, tm) {
  const p = store.get(pid);
  if (!p || isPristine(p)) return 0;
  const st = await tm.state();
  if (st.fold.phases.length) return 0;
  const me = st.me.id;
  let n = 0;
  for (const ph of [...p.phases]) {
    const r = await tm.emit('phase_created', { phaseId: team.newPhaseId(tm.random), name: bare(ph).replace(/-/g, ' '), plannedBy: me });
    const phaseId = r.event.phaseId;
    const lines = String((p.phaseNotes || {})[ph] || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(TASK);
      if (!m || markerOf(lines[i])) continue;
      const taskId = team.newTaskId(tm.random);
      await tm.emit('task_added', { phaseId, taskId, text: m[3].trim() });
      if (m[2].trim()) await tm.emit('task_done', { phaseId, taskId });
      lines[i] = `${m[1]}[${m[2].trim() ? 'x' : ' '}] ${m[3].trim()} <!--vt:${taskId}-->`;
      n++;
    }
    if ((p.phaseNotes || {})[ph] != null) { p.phaseNotes[ph] = lines.join('\n'); }
    p.team = p.team || {}; p.team.phaseMap = { ...(p.team.phaseMap || {}), [phaseId]: ph };
  }
  store.save(p);
  const after = await tm.state();
  store.syncTeamPlan(pid, after.fold.phases, syncNotes);
  return n;
}

// The "Team" section of Gemini's system prompt (max 3000 characters)
function teamPromptSection(st) {
  if (!st) return '';
  const f = st.fold, me = st.me.id;
  const name = id => team.nameOf(f, id);
  const L = ['Team (this project is shared with teammates through Vyuha team context):'];
  L.push(`- Members: ${f.members.map(m => m.name + (m.id === me ? ' (you are working for this person)' : '')).join(', ')}`);
  L.push(`- Phase owners: ${f.phases.map(p => `${p.name}: ${p.owner ? name(p.owner) : 'unowned'} (${p.progress.done}/${p.progress.total})`).join('; ') || 'no phases yet'}`);
  const mine = f.phases.flatMap(p => p.tasks.filter(t => t.assignee === me && !t.done).map(t => `${t.text} (${p.name})`));
  L.push(`- Tasks claimed by the user: ${mine.join('; ') || 'none'}`);
  const decs = f.decisions.filter(d => d.status === 'current').slice(-10).map(d => `${d.title}${d.area ? ` [${d.area}]` : ''}: ${d.detail}`);
  L.push(`- Current team decisions: ${decs.join(' | ') || 'none'}`);
  const fixed = (st.issues || []).filter(i => i.status === 'fixed').sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt))).slice(0, 5);
  L.push(`- Recently fixed issues: ${fixed.map(i => `${i.title} (${name(i.by)})`).join('; ') || 'none'}`);
  L.push('- Before you start work on a task, call claim_task for it so teammates can see who is doing what. Phases owned by someone else: don’t rename or reorder them.');
  L.push('- When a run_command result includes team_knowledge, a teammate already fixed that error: apply their fix first and say whose it was.');
  return L.join('\n').slice(0, 3000);
}

// What the issue hooks need from a project: the current team phase, Gemini's replies since an issue opened
// (never the user's own prompts) and the sources filed since then
function commandContext(store, pid) {
  const p = store.get(pid);
  const map = (p && p.team && p.team.phaseMap) || {};
  return {
    phaseId: Object.keys(map).find(id => map[id] === (p && p.phase)) || null,
    geminiReplies: issue => (store.readChat(pid).transcript || []).filter(m => m.role === 'agent' && m.text && m.at >= Date.parse(issue.openedAt)).map(m => m.text),
    sourcesSince: ms => ((store.get(pid) || {}).events || []).filter(e => parseInt(String(e.id).slice(1, -4), 36) >= ms).map(e => e.url)
  };
}

module.exports = { planOps, commandContext, syncNotes, importLocalPlan, teamPromptSection, isPristine, stripMarkers, markerOf, Rejected };
