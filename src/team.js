// Team context: a shared layer for several people working on the same repository.
// It lives on its own orphan branch (vyuha_context), checked out as a git worktree at
// <project root>/.vyuha/team/, and is synced only through git.
//
//   team.json                  written once by the first publisher
//   TEAM.md                    readable summary, regenerated on every publish
//   people/<id>/profile.json   who this person is
//   people/<id>/events.jsonl   append-only event log (plan, ownership, claims, progress, decisions)
//   people/<id>/issues.json    published issue cards (error → cause → fix)
//   people/<id>/style.json     exported answer style (only if the person opted in)
//
// Each person only ever writes their own folder, so publishing never conflicts. Authority
// (who may rename a phase, take it over…) is checked when events are folded, never trusted
// at write time, because anyone can write anything into their own folder.
//
// Pure Node: no Electron. The git runner, clock, token and Gemini write-up are injected so the
// whole thing runs headless in tests.
const fs = require('fs');
const path = require('path');
const os = require('os');

const BRANCH = 'vyuha_context';
const TAKEOVER_MINUTES = 120;

/* ---------- small helpers ---------- */
const slugId = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'someone';
const rand4 = (random = Math.random) => Math.floor(random() * 0x10000).toString(16).padStart(4, '0');
const iso = ms => new Date(ms).toISOString();
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return dflt; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
function readJsonl(f) {
  let text = '';
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* a torn line: skip it */ }
  }
  return out;
}

// Events by id, sorted the way the fold sorts them (time, then id)
function unionEvents(a, b) {
  const byId = new Map();
  for (const e of [...(a || []), ...(b || [])]) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => (String(x.at) < String(y.at) ? -1 : String(x.at) > String(y.at) ? 1 : String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
}

function eventId(atIso, by, random) { return `${atIso}-${by}-${rand4(random)}`; }
function makeEvent(type, payload, { by, now = Date.now, random = Math.random }) {
  const at = iso(now());
  return { id: eventId(at, by, random), at, by, type, ...payload };
}
const newPhaseId = random => 'ph-' + rand4(random) + rand4(random);
const newTaskId = random => 't-' + rand4(random) + rand4(random);
const newDecisionId = random => 'd-' + rand4(random) + rand4(random);

/* ---------- the fold: every person's events → one team state ---------- */
// fold(teamJson, eventsByPerson, profiles?) sorts all events by (at, id) and applies the rules.
// Rejected events don't change state; they are listed with the reason.
function fold(teamJson, eventsByPerson, profiles = {}) {
  const team = teamJson || {};
  const creator = team.createdBy || null;
  const takeoverMs = (Number(team.takeoverAfterMinutes) || TAKEOVER_MINUTES) * 60e3;
  const all = [];
  for (const [person, list] of Object.entries(eventsByPerson || {})) {
    for (const e of list || []) {
      if (!e || typeof e !== 'object') continue;
      // a person's folder can only speak for that person
      all.push(e.by === person ? e : { ...e, _forged: true });
    }
  }
  // the same event can appear twice (e.g. local copy + published copy): keep one
  const seen = new Set();
  const events = all.filter(e => { const k = e.id + '|' + e.by; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

  const phases = new Map();      // id → phase
  const created = [];            // phase ids in creation order
  let order = null;              // accepted phase_reordered
  const decisions = new Map();
  const decisionOrder = [];
  const lastActivity = {};
  const ownershipLog = [];
  const rejected = [];
  const accepted = [];
  const ms = s => Date.parse(s);
  const nm = id => (profiles && profiles[id] && profiles[id].name) || id;

  const reject = (e, reason) => rejected.push({ event: e, reason });
  const setOwner = (ph, to, e, action, extra = {}) => {
    ownershipLog.push({ phaseId: ph.id, phase: ph.name, at: e.at, by: e.by, action, from: ph.owner, to, ...extra });
    ph.owner = to;
  };
  const livePhase = (e) => {
    const ph = phases.get(e.phaseId);
    if (!ph) return [null, 'unknown phase'];
    if (ph.removed) return [null, `phase "${ph.name}" was removed`];
    return [ph, null];
  };
  const liveTask = (ph, e) => {
    const t = ph.tasks.find(x => x.id === e.taskId);
    if (!t) return [null, 'unknown task'];
    if (t.removed) return [null, `task "${t.text}" was removed`];
    return [t, null];
  };
  const ownerOnly = (ph, e, what) => {
    if (!ph.owner) return `only the phase owner can ${what}, and "${ph.name}" has no owner yet`;
    if (ph.owner !== e.by) return `only ${nm(ph.owner)} (owner of "${ph.name}") can ${what}`;
    return null;
  };

  for (const e of events) {
    const before = lastActivity[e.by];
    if (!e._forged && e.by) lastActivity[e.by] = !before || e.at > before ? e.at : before;
    if (e._forged) { reject(e, 'event written into another person’s folder'); continue; }
    if (!e.by || !e.at || !e.type || isNaN(ms(e.at))) { reject(e, 'malformed event'); continue; }
    let why = null;
    switch (e.type) {
      case 'phase_created': {
        if (!e.phaseId || !String(e.name || '').trim()) { why = 'a phase needs an id and a name'; break; }
        if (phases.has(e.phaseId)) { why = 'a phase with this id already exists'; break; }
        phases.set(e.phaseId, { id: e.phaseId, name: String(e.name).trim(), owner: null, plannedBy: e.plannedBy || e.by, createdAt: e.at, tasks: [], removed: false, takenFrom: null });
        created.push(e.phaseId);
        break;
      }
      case 'phase_started': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        if (ph.owner && ph.owner !== e.by) { why = `"${ph.name}" is already owned by ${nm(ph.owner)}`; break; }
        if (!ph.owner) setOwner(ph, e.by, e, 'started');
        break;
      }
      case 'task_claimed': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        const [t, terr] = liveTask(ph, e); if (terr) { why = terr; break; }
        t.assignee = e.by;
        if (!ph.owner) setOwner(ph, e.by, e, 'claimed a task');
        break;
      }
      case 'task_done':
      case 'task_reopened': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        const [t, terr] = liveTask(ph, e); if (terr) { why = terr; break; }
        if (e.type === 'task_done') {
          Object.assign(t, { done: true, doneBy: e.by, doneAt: e.at });
          if (!ph.owner) setOwner(ph, e.by, e, 'finished a task');
        } else Object.assign(t, { done: false, doneBy: null, doneAt: null });
        break;
      }
      case 'task_assigned': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        const [t, terr] = liveTask(ph, e); if (terr) { why = terr; break; }
        if (!e.to) { why = 'nobody to assign to'; break; }
        t.assignee = e.to;
        break;
      }
      case 'task_added': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        if (!e.taskId || !String(e.text || '').trim()) { why = 'a task needs an id and text'; break; }
        if (ph.tasks.some(x => x.id === e.taskId)) { why = 'a task with this id already exists'; break; }
        ph.tasks.push({ id: e.taskId, text: String(e.text).trim(), assignee: null, done: false, doneBy: null, doneAt: null, addedBy: e.by, removed: false });
        break;
      }
      case 'task_renamed':
      case 'task_removed': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        const [t, terr] = liveTask(ph, e); if (terr) { why = terr; break; }
        why = ownerOnly(ph, e, e.type === 'task_renamed' ? 'rename its tasks' : 'remove its tasks'); if (why) break;
        if (e.type === 'task_renamed') {
          if (!String(e.text || '').trim()) { why = 'a task needs text'; break; }
          t.text = String(e.text).trim();
        } else t.removed = true;
        break;
      }
      case 'task_reordered': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        why = ownerOnly(ph, e, 'reorder its tasks'); if (why) break;
        if (!Array.isArray(e.order)) { why = 'no order given'; break; }
        const pos = new Map(e.order.map((id, i) => [id, i]));
        ph.tasks.sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
        break;
      }
      case 'phase_renamed': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        why = ownerOnly(ph, e, 'rename it'); if (why) break;
        if (!String(e.name || '').trim()) { why = 'a phase needs a name'; break; }
        ph.name = String(e.name).trim();
        break;
      }
      case 'phase_removed': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        why = ownerOnly(ph, e, 'remove it'); if (why) break;
        ph.removed = true;
        break;
      }
      case 'phase_reordered': {
        if (!creator || e.by !== creator) { why = `only the project creator (${nm(creator) || 'unknown'}) can reorder phases`; break; }
        if (!Array.isArray(e.order) || !e.order.length) { why = 'no order given'; break; }
        const unknown = e.order.filter(id => !phases.has(id));
        if (unknown.length) { why = `unknown phase ids: ${unknown.join(', ')}`; break; }
        order = [...e.order];
        break;
      }
      case 'phase_handoff': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        if (!ph.owner || ph.owner !== e.by) { why = `only the current owner (${nm(ph.owner) || 'nobody'}) can hand off "${ph.name}"`; break; }
        if (!e.to || e.to === e.by) { why = 'hand off to someone else'; break; }
        setOwner(ph, e.to, e, 'handed off');
        ph.takenFrom = null;
        break;
      }
      case 'phase_takeover': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        if (!ph.owner) { why = `"${ph.name}" has no owner; start it instead`; break; }
        if (ph.owner === e.by) { why = 'you already own this phase'; break; }
        const last = lastActivityBefore(events, ph.owner, e);
        const idle = last ? ms(e.at) - ms(last) : Infinity;
        if (idle < takeoverMs) {
          why = `${nm(ph.owner)} was active ${Math.round(idle / 60e3)} min ago; takeover is allowed after ${Math.round(takeoverMs / 60e3)} min of inactivity`;
          break;
        }
        const from = ph.owner;
        setOwner(ph, e.by, e, 'took over', { takenFrom: from });
        ph.takenFrom = from;
        break;
      }
      case 'phase_takeback': {
        const [ph, err] = livePhase(e); if (err) { why = err; break; }
        if (!ph.takenFrom || ph.takenFrom !== e.by) { why = ph.takenFrom ? `only ${nm(ph.takenFrom)} can take "${ph.name}" back` : `"${ph.name}" was not taken over from anyone`; break; }
        setOwner(ph, e.by, e, 'took back');
        ph.takenFrom = null;
        break;
      }
      case 'decision_recorded': {
        if (!e.decisionId || !String(e.title || '').trim()) { why = 'a decision needs an id and a title'; break; }
        if (decisions.has(e.decisionId)) { why = 'a decision with this id already exists'; break; }
        decisions.set(e.decisionId, { id: e.decisionId, phaseId: e.phaseId || null, area: e.area || '', title: String(e.title).trim(), detail: e.detail || '',
                                      sources: Array.isArray(e.sources) ? e.sources : [], by: e.by, at: e.at, status: 'current', supersededBy: null, supersededByPerson: null, reason: '' });
        decisionOrder.push(e.decisionId);
        break;
      }
      case 'decision_superseded': {
        const d = decisions.get(e.decisionId);
        if (!d) { why = 'unknown decision'; break; }
        if (d.status === 'superseded') { why = 'already superseded'; break; }
        Object.assign(d, { status: 'superseded', supersededBy: e.replacedBy || null, supersededByPerson: e.by, supersededAt: e.at, reason: e.reason || '' });
        break;
      }
      default: why = `unknown event type ${e.type}`;
    }
    if (why) reject(e, why); else accepted.push(e);
  }

  // phase order: creation order unless the creator reordered
  let ids = created.filter(id => !phases.get(id).removed);
  if (order) {
    const pos = new Map(order.map((id, i) => [id, i]));
    ids = [...ids].sort((a, b) => (pos.has(a) ? pos.get(a) : 1e6 + created.indexOf(a)) - (pos.has(b) ? pos.get(b) : 1e6 + created.indexOf(b)));
  }
  const outPhases = ids.map(id => {
    const ph = phases.get(id);
    const tasks = ph.tasks.filter(t => !t.removed).map(t => ({ id: t.id, text: t.text, assignee: t.assignee, done: t.done, doneBy: t.doneBy, doneAt: t.doneAt }));
    return { id: ph.id, name: ph.name, owner: ph.owner, plannedBy: ph.plannedBy, createdAt: ph.createdAt, takenFrom: ph.takenFrom,
             tasks, progress: { done: tasks.filter(t => t.done).length, total: tasks.length } };
  });

  const memberIds = new Set([...Object.keys(profiles || {}), ...Object.keys(eventsByPerson || {}), ...(creator ? [creator] : [])]);
  const members = [...memberIds].sort().map(id => ({ id, name: (profiles[id] && profiles[id].name) || id, email: (profiles[id] && profiles[id].email) || '' }));
  return {
    project: team.project || '',
    members, creator,
    takeoverAfterMinutes: Math.round(takeoverMs / 60e3),
    phases: outPhases,
    decisions: decisionOrder.map(id => decisions.get(id)),
    lastActivity, ownershipLog, rejected, accepted
  };
}

// The owner's latest event strictly before event e (in fold order)
function lastActivityBefore(events, person, e) {
  let last = null;
  for (const x of events) {
    if (x === e) break;
    if (x.by === person && !x._forged && (!last || x.at > last)) last = x.at;
  }
  return last;
}

// Why a takeover would be refused right now, or null if it's allowed (for disabling the button)
function takeoverBlocked(f, phaseId, me, nowMs) {
  const ph = f.phases.find(p => p.id === phaseId);
  if (!ph) return 'Unknown phase';
  if (!ph.owner) return 'Nobody owns this phase yet; start it instead';
  if (ph.owner === me) return 'You own this phase';
  const last = f.lastActivity[ph.owner];
  const idle = last ? nowMs - Date.parse(last) : Infinity;
  const limit = f.takeoverAfterMinutes * 60e3;
  if (idle < limit) return `${nameOf(f, ph.owner)} was active ${Math.max(0, Math.round(idle / 60e3))} min ago. Takeover opens after ${f.takeoverAfterMinutes} min without activity.`;
  return null;
}
const nameOf = (f, id) => ((f.members || []).find(m => m.id === id) || { name: id || 'nobody' }).name;

/* ---------- scrubbing secrets out of anything that may be published ---------- */
const SECRET_PATTERNS = [
  /ghp_\w+/g, /github_pat_\w+/g, /AIza[\w-]{30,}/g, /sk-\w{20,}/g, /Bearer\s+\S+/gi,
  /(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi
];
function scrub(text, home = os.homedir()) {
  let s = String(text == null ? '' : text);
  for (const re of SECRET_PATTERNS) s = s.replace(re, '[redacted]');
  if (home && home.length > 2) {
    const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')]);
    for (const h of variants) s = s.split(h).join('~');
  }
  return s;
}
const scrubDeep = (v, home) => (typeof v === 'string' ? scrub(v, home) : Array.isArray(v) ? v.map(x => scrubDeep(x, home))
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x, home)])) : v);

/* ---------- issues: error signatures, matching ---------- */
// a 4xx/5xx counts as an HTTP status only when it isn't part of a decimal ("3.402 s") or a line number ("http.js:572")
const ERR_LINE = /(error|exception|traceback|failed|denied|not found|cannot|unauthori[sz]ed|refused|(?<![\d.:])\b[45]\d\d\b(?![\d.:]))/i;
// "npm test", "python train.py": the first two words, lowercased
const normaliseCommand = cmd => String(cmd || '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

function normaliseLine(line) {
  let s = String(line).toLowerCase();
  const urls = [];
  // URLs: keep scheme, host and path; drop the port; protect them from the path rule below
  s = s.replace(/\b([a-z][a-z0-9+.-]*):\/\/([^\s/:'")]+)(?::\d+)?(\/[^\s'")]*)?/g, (m, pr, host, p) => {
    urls.push(`${pr}://${host}${(p || '').replace(/\d+/g, '<n>')}`); return `\u0001${urls.length - 1}\u0001`;
  });
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<n>');                       // uuids
  s = s.replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})?/g, '<n>');           // timestamps
  s = s.replace(/\b\d{4}-\d{2}-\d{2}t\d{2}[_:]\d{2}[_:]\d{2}(?:[_.]\d+)?z?/g, '<n>');                               // timestamps in log file names (npm)
  s = s.replace(/\b\d{1,2}:\d{2}:\d{2}(\.\d+)?\b/g, '<n>');
  s = s.replace(/(?:[a-z]:)?(?:[\\/]?[\w.@~+-]+)*[\\/]([\w.@+-]+)/g, '$1');                                    // paths → basename
  s = s.replace(/\b0x[0-9a-f]+\b/g, '<n>').replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/g, '<n>');  // hex
  s = s.replace(/:\d+(?::\d+)?\b/g, ':<n>');                                                                     // line:col, ports
  s = s.replace(/\bline\s+\d+/g, 'line <n>');
  s = s.replace(/\b\d+(?:\.\d+)?\b/g, m => (/^[45]\d\d$/.test(m) ? m : '<n>'));                               // numbers (not 4xx/5xx)
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => urls[i]);
  return s.replace(/\s+/g, ' ').trim();
}
// Stack frames ("at fn (file:1:2)", 'File "x.py"', "src/model.py:8:"), frames inside libraries, and test-runner
// summary lines that every failing run prints the same way ("Test Suites: 1 failed", "npm ERR! Failed at…", "== 1 failed in 2s ==")
const FRAME = /^(at\s|File\s"|\S+\.\w+:\d+(?::\d+)?:)/;
const LIB = /node_modules|site-packages|dist-packages|node:|<frozen /;
const RUNNER_NOISE = /^(npm (err!|warn)|test suites:|tests:|snapshots:|time:|ran all test suites|=+ .*\b(passed|failed|error)\b.* =+$|\[exit )/i;
const tailLines = output => String(output || '').slice(-4000).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
// The error lines of the output's tail, normalised (at most `max`). Falls back to the last line when nothing looks like an error.
function errorLines(output, max = 20) {
  const lines = tailLines(output);
  const errs = lines.filter(l => ERR_LINE.test(l) && !LIB.test(l) && !RUNNER_NOISE.test(l));
  return (errs.length ? errs : lines.slice(-1)).slice(0, max).map(normaliseLine);
}
// What matching compares: the error lines plus the project's own stack frames (normalised, at most 20)
function errorBlock(output, max = 20) {
  const lines = tailLines(output);
  const block = lines.filter(l => (ERR_LINE.test(l) || FRAME.test(l)) && !LIB.test(l) && !RUNNER_NOISE.test(l));
  return (block.length ? block : lines.slice(-1)).slice(0, max).map(normaliseLine);
}
// The grouping key for repeats of the same error: errorType + the normalised FIRST error line
function signature(output) {
  return `${errorTypeOf(output)}|${errorLines(output, 1)[0] || ''}`;
}
function errorTypeOf(output) {
  const s = String(output || '').slice(-4000);
  let m = s.match(/\b([A-Z][A-Za-z0-9]*(?:Error|Exception))\b/);
  if (m) return m[1];
  m = s.match(/\b(E[A-Z]{3,}[A-Z0-9_]*)\b/);
  if (m) return m[1];
  m = s.match(/(?:status(?: code)?|http\/[\d.]+|code|response)\D{0,3}([45]\d\d)\b/i) || s.match(/\b([45]\d\d)\b/);
  return m ? m[1] : '';
}
const FILE_RE = /[\w.-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|ipynb|json|java|go|rb|rs|c|cc|cpp|h|cs|php|vue|svelte|html|css|scss|yml|yaml|toml|sql|sh)\b/gi;
const basenames = text => [...new Set((String(text || '').match(FILE_RE) || []).map(f => f.toLowerCase()))];
// Words that every failing run prints (runner boilerplate, English filler): they say nothing about which error it is
const TOKEN_STOP = new Set(('a an the and or of to in on at for with from by is was be are not it this that as into then when while e n s ' +
  'err error errors failed failing failure fail fails passed pass passing test tests total npm code errno exit see above more details log run').split(' '));
// Tokens of normalised error lines (a string or an array of lines). The error type itself is left out: it has its own weight.
const sigTokens = (lines, errorType = '') => {
  const text = Array.isArray(lines) ? lines.join(' ') : String(lines || '');
  const type = String(errorType || '').toLowerCase();
  return new Set((text.match(/[a-z_][a-z0-9_.]*|[45]\d\d/g) || []).map(t => t.replace(/\.+$/, ''))
    .filter(t => t.length > 1 && !TOKEN_STOP.has(t) && t !== type));
};
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
// File names an error points at: its error block (error lines + project stack frames; library frames and
// test-runner progress lines are left out: every run of the same suite prints those)
function involvedFiles(output) {
  return basenames(errorBlock(output).join('\n'));
}
// The normalised error lines of an issue card (older cards without them: from the excerpt)
const cardLines = i => (Array.isArray(i.errorLines) && i.errorLines.length ? i.errorLines : i.errorExcerpt ? errorBlock(i.errorExcerpt) : [String(i.signature || '')]);
// error: raw output text, or { errorLines, errorType }; files: file names involved on my side.
// score = 0.6 × Jaccard(tokens of the whole error block: all normalised error lines + project frames, max 20)
//       + 0.2 × same errorType + 0.1 × same command + 0.1 × shared file names (from the error block, plus files written/changed)
function matchIssues(error, command, files, issues, { threshold = 0.55, limit = 2 } = {}) {
  const lines = typeof error === 'string' ? errorBlock(error) : error.errorLines || [String(error.signature || '')];
  const type = typeof error === 'string' ? errorTypeOf(error) : error.errorType || '';
  const mine = new Set([...(files || []).map(f => path.basename(String(f)).toLowerCase()), ...(typeof error === 'string' ? involvedFiles(error) : basenames(lines.join(' ')))]);
  const tok = sigTokens(lines, type), cmd = normaliseCommand(command);
  const scored = [];
  for (const i of issues || []) {
    if (!i || !i.signature) continue;
    const theirLines = cardLines(i);
    const theirs = new Set([...(i.filesChanged || []).map(f => path.basename(String(f)).toLowerCase()), ...basenames(theirLines.join(' ')), ...involvedFiles(i.errorExcerpt)]);
    const shared = [...mine].some(f => theirs.has(f));
    const parts = { signature: jaccard(tok, sigTokens(theirLines, i.errorType)), errorType: type && i.errorType && type === i.errorType ? 1 : 0,
                    command: cmd && normaliseCommand(i.command) === cmd ? 1 : 0, files: shared ? 1 : 0 };
    const score = 0.6 * parts.signature + 0.2 * parts.errorType + 0.1 * parts.command + 0.1 * parts.files;
    scored.push({ issue: i, score: Math.round(score * 1000) / 1000, parts, kind: i.status === 'fixed' ? 'fix' : 'also_stuck' });
  }
  return scored.filter(s => s.score >= threshold).sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---------- TEAM.md: a readable summary for managers ---------- */
const day = s => (s ? String(s).replace('T', ' ').slice(0, 16) + ' UTC' : '');
function describeEvent(e, f) {
  const who = nameOf(f, e.by);
  const ph = id => { const p = f.phases.find(x => x.id === id); return p ? `"${p.name}"` : 'a phase'; };
  const task = (pid, tid) => { const p = f.phases.find(x => x.id === pid); const t = p && p.tasks.find(x => x.id === tid); return t ? `"${t.text}"` : 'a task'; };
  switch (e.type) {
    case 'phase_created': return `${who} planned phase "${e.name}"`;
    case 'phase_started': return `${who} started ${ph(e.phaseId)}`;
    case 'task_claimed': return `${who} claimed ${task(e.phaseId, e.taskId)}`;
    case 'task_done': return `${who} finished ${task(e.phaseId, e.taskId)}`;
    case 'task_reopened': return `${who} reopened ${task(e.phaseId, e.taskId)}`;
    case 'task_assigned': return `${who} assigned ${task(e.phaseId, e.taskId)} to ${nameOf(f, e.to)}`;
    case 'task_added': return `${who} added task "${e.text}" to ${ph(e.phaseId)}`;
    case 'task_renamed': return `${who} renamed a task to "${e.text}"`;
    case 'task_removed': return `${who} removed a task from ${ph(e.phaseId)}`;
    case 'task_reordered': return `${who} reordered the tasks of ${ph(e.phaseId)}`;
    case 'phase_renamed': return `${who} renamed a phase to "${e.name}"`;
    case 'phase_removed': return `${who} removed a phase`;
    case 'phase_reordered': return `${who} reordered the phases`;
    case 'phase_handoff': return `${who} handed ${ph(e.phaseId)} to ${nameOf(f, e.to)}`;
    case 'phase_takeover': return `${who} took over ${ph(e.phaseId)}`;
    case 'phase_takeback': return `${who} took back ${ph(e.phaseId)}`;
    case 'decision_recorded': return `${who} decided "${e.title}"`;
    case 'decision_superseded': return `${who} superseded a decision`;
    default: return `${who}: ${e.type}`;
  }
}
const STYLE_NAMES = { overview: 'Overview', stepwise: 'Step by step', deep: 'Full detail', clarify: 'Ask first' };
const md = s => String(s == null ? '' : s).replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();

// state = { fold, issues: [card], styles: { personId: style }, publishedAt, publishedBy }
function renderTeamMd(state) {
  const f = state.fold;
  const L = [];
  L.push(`# Team context: ${md(f.project) || 'project'}`, '');
  L.push(`_Regenerated by Vyuha on every publish; edits here are overwritten.${state.publishedAt ? ` Last published ${day(state.publishedAt)} by ${md(nameOf(f, state.publishedBy))}.` : ''}_`, '');
  L.push('## Overview', '');
  if (!f.phases.length) L.push('No phases planned yet.', '');
  else {
    L.push('| # | Phase | Owner | Progress | Planned by |', '|---|---|---|---|---|');
    f.phases.forEach((p, i) => L.push(`| ${i + 1} | ${md(p.name)} | ${p.owner ? md(nameOf(f, p.owner)) : '_unowned_'} | ${p.progress.done}/${p.progress.total} | ${md(nameOf(f, p.plannedBy))} |`));
    L.push('');
    for (const p of f.phases) {
      L.push(`### ${md(p.name)} (${p.progress.done}/${p.progress.total})`, '');
      if (!p.tasks.length) L.push('_No tasks yet._');
      for (const t of p.tasks) L.push(`- [${t.done ? 'x' : ' '}] ${md(t.text)}${t.assignee ? ` (${md(nameOf(f, t.assignee))})` : ''}${t.done && t.doneBy ? `, done by ${md(nameOf(f, t.doneBy))}` : ''}`);
      L.push('');
    }
  }
  L.push('## Members', '');
  for (const m of f.members) L.push(`- ${md(m.name)}${m.id === f.creator ? ' (created the team context)' : ''}${f.lastActivity[m.id] ? `, last active ${day(f.lastActivity[m.id])}` : ''}`);
  L.push('');
  L.push('## Issues and fixes', '');
  const issues = (state.issues || []).slice().sort((a, b) => String(b.resolvedAt || b.openedAt).localeCompare(String(a.resolvedAt || a.openedAt)));
  if (!issues.length) L.push('No issues published yet.', '');
  for (const i of issues) {
    L.push(`### ${md(i.title || i.command)} (${i.status === 'fixed' ? 'fixed' : 'open'}, ${md(nameOf(f, i.by))})`, '');
    L.push(`- Command: \`${md(i.command)}\`${i.errorType ? `, error: \`${md(i.errorType)}\`` : ''}${i.area ? `, area: ${md(i.area)}` : ''}`);
    if (i.symptom) L.push(`- Symptom: ${md(i.symptom)}`);
    if (i.cause) L.push(`- Cause: ${md(i.cause)}`);
    if (i.fix) L.push(`- Fix: ${md(i.fix)}`);
    if ((i.filesChanged || []).length) L.push(`- Files: ${i.filesChanged.map(x => '`' + md(x) + '`').join(', ')}`);
    L.push('');
  }
  L.push('## Decisions', '');
  if (!f.decisions.length) L.push('No decisions recorded yet.', '');
  for (const d of f.decisions) {
    const head = `${md(d.title)}${d.area ? ` (${md(d.area)})` : ''}`;
    if (d.status === 'superseded') {
      const by = f.decisions.find(x => x.id === d.supersededBy);
      L.push(`- ~~${head}~~: superseded${by ? ` by "${md(by.title)}"` : ''} (${md(nameOf(f, d.supersededByPerson))}): ${md(d.reason) || 'no reason given'}`);
    } else L.push(`- **${head}**: ${md(d.detail)} (${md(nameOf(f, d.by))}, ${day(d.at)})`);
  }
  L.push('');
  L.push('## Timeline', '');
  const recent = f.accepted.slice(-40).reverse();
  if (!recent.length) L.push('Nothing yet.');
  for (const e of recent) L.push(`- ${day(e.at)}: ${md(describeEvent(e, f))}`);
  L.push('');
  L.push('## Answer styles', '');
  const styles = Object.entries(state.styles || {});
  if (!styles.length) L.push('Nobody has shared an answer style yet.');
  for (const [id, s] of styles) {
    const mix = Object.entries((s && s.styleMix) || {}).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0).slice(0, 2).map(x => STYLE_NAMES[x[0]] || x[0]);
    L.push(`- ${md(nameOf(f, id))} shares an answer style${mix.length ? ` (leans towards ${mix.join(', ')})` : ''}`);
  }
  L.push('');
  return L.join('\n');
}

/* ---------- one project's team context on disk and in git ---------- */
const LOCAL_ONLY_ISSUE_FIELDS = ['include', 'published', 'dirtyAtOpen', 'written', 'geminiFrom'];
const isRejection = r => /non-fast-forward|fetch first|rejected|failed to push|cannot lock ref|stale info/i.test((r.stderr || '') + (r.stdout || ''));

class Team {
  constructor({ root, project = '', git = require('./git'), now = Date.now, random = Math.random, token = () => null, identity = null, home = os.homedir(), writeUp = null } = {}) {
    if (!root) throw new Error('Team needs a project root');
    Object.assign(this, { root, project, git, now, random, token, identity, home, writeUp });
    this.teamDir = path.join(root, '.vyuha', 'team');
    this.localDir = path.join(root, '.vyuha', 'team-local');
  }
  static isEnabled(root) {
    return !!root && fs.existsSync(path.join(root, '.vyuha', 'team', 'team.json')) && fs.existsSync(path.join(root, '.vyuha', 'team-local', 'settings.json'));
  }
  enabled() { return Team.isEnabled(this.root); }

  /* local files (never committed) */
  file(name) { return path.join(this.localDir, name); }
  settings() { return readJson(this.file('settings.json'), {}); }
  saveSettings(patch) { const s = { ...this.settings(), ...patch }; writeJson(this.file('settings.json'), s); return s; }
  localEvents() { return readJsonl(this.file('events.jsonl')); }
  localIssues() { return readJson(this.file('issues.json'), []); }
  saveIssues(list) { writeJson(this.file('issues.json'), list); }
  teamJson() { return readJson(path.join(this.teamDir, 'team.json'), null); }

  async me() {
    const s = this.settings();
    if (s.me && s.me.id) return s.me;
    const get = async k => { const r = await this.git.run(this.root, ['config', k]); return r.code === 0 ? r.stdout.trim() : ''; };
    let email = await get('user.email'), name = await get('user.name');
    if (!email && this.identity) { const id = await this.identity(); if (id) { email = id.email || ''; name = name || id.name || ''; } }
    if (!email) throw new Error('Git needs your name and email first. Add a GitHub token in Settings, or run: git config user.email you@example.com');
    return { id: slugId(email), name: name || email.split('@')[0], email };
  }
  async identityArgs(me) { me = me || await this.me(); return ['-c', `user.name=${me.name}`, '-c', `user.email=${me.email}`]; }
  net(cwd, args) { return this.git.run(cwd, args, { token: this.token && this.token(), timeout: 180000 }); }
  async gitOk(cwd, args, what, netCall) {
    const r = netCall ? await this.net(cwd, args) : await this.git.run(cwd, args);
    if (r.code !== 0) throw new Error(`${what}: ${this.git.errorText ? this.git.errorText(r) : (r.stderr || r.stdout)}`);
    return r;
  }

  /* everyone's published files, with my local copy taking the place of my own folder */
  async readAll() {
    const me = await this.me();
    const profiles = {}, events = {}, issues = [], styles = {};
    const peopleDir = path.join(this.teamDir, 'people');
    let ids = [];
    try { ids = fs.readdirSync(peopleDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (e) { /* nobody yet */ }
    for (const id of ids) {
      if (id === me.id) continue;
      const dir = path.join(peopleDir, id);
      const prof = readJson(path.join(dir, 'profile.json'), null);
      profiles[id] = { id, name: (prof && prof.name) || id, email: (prof && prof.email) || '' };
      events[id] = readJsonl(path.join(dir, 'events.jsonl'));
      for (const c of readJson(path.join(dir, 'issues.json'), [])) if (c && c.by === id) issues.push(c);
      const st = readJson(path.join(dir, 'style.json'), null);
      if (st) styles[id] = st;
    }
    profiles[me.id] = { id: me.id, name: me.name, email: me.email };
    events[me.id] = this.localEvents();
    for (const c of this.localIssues()) if (c.include || c.published) issues.push(this.card(c));
    const s = this.settings();
    if (s.shareStyle && s.lastStyle) styles[me.id] = s.lastStyle;
    return { me, profiles, events, issues, styles };
  }
  async state() {
    const all = await this.readAll();
    const f = fold(this.teamJson(), all.events, all.profiles);
    return { me: all.me, fold: f, issues: all.issues, styles: all.styles, settings: this.settings() };
  }

  // Record one of my events. Returns the event and, if the fold refuses it, why.
  async emit(type, payload) {
    const me = await this.me();
    // An event always sorts after every event I have already seen (mine and teammates'), even within one
    // millisecond or when my clock is behind theirs: the fold sorts by time, then id.
    const seen = await this.readAll();
    let prev = 0;
    for (const list of Object.values(seen.events)) for (const x of list) prev = Math.max(prev, Date.parse(x.at) || 0);
    const now = this.now();
    const e = makeEvent(type, payload, { by: me.id, now: () => (now > prev ? now : prev + 1), random: this.random });
    fs.mkdirSync(this.localDir, { recursive: true });
    fs.appendFileSync(this.file('events.jsonl'), JSON.stringify(e) + '\n');
    const st = await this.state();
    const r = st.fold.rejected.find(x => x.event.id === e.id);
    return { event: e, rejected: r ? r.reason : null, state: st };
  }

  card(issue) {
    const c = { ...issue };
    for (const k of LOCAL_ONLY_ISSUE_FIELDS) delete c[k];
    return scrubDeep(c, this.home);
  }

  /* ---------- git: set up, pull, publish ---------- */
  async gitVersion() {
    const r = await this.git.run(this.root, ['--version']);
    const m = (r.stdout || '').match(/(\d+)\.(\d+)/);
    return m ? [+m[1], +m[2]] : [0, 0];
  }
  async remoteExists() {
    const r = await this.net(this.root, ['ls-remote', '--exit-code', '--heads', 'origin', BRANCH]);
    if (r.code === 0) return true;
    if (r.code === 2) return false;
    throw new Error(`Could not reach GitHub: ${this.git.errorText ? this.git.errorText(r) : r.stderr}`);
  }
  async fetchBranch() {
    return this.gitOk(this.root, ['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}`], 'Could not fetch the team context', true);
  }
  worktreeReady() { return fs.existsSync(path.join(this.teamDir, '.git')); }

  async setup({ _retry = false } = {}) {
    const top = await this.git.run(this.root, ['rev-parse', '--show-toplevel']);
    const remote = top.code === 0 ? await this.git.run(this.root, ['remote', 'get-url', 'origin']) : { code: 1 };
    if (top.code !== 0 || remote.code !== 0 || !String(remote.stdout).trim()) {
      throw new Error('Publish this project to GitHub first: team context is shared through the project’s GitHub repository.');
    }
    const me = await this.me();
    if (this.git.excludeVyuha) await this.git.excludeVyuha(this.root);
    await this.git.run(this.root, ['worktree', 'prune']);
    const exists = await this.remoteExists();
    let created = false;
    if (this.worktreeReady()) {
      if (exists) await this.pull();
    } else if (exists) {
      await this.fetchBranch();
      fs.mkdirSync(path.dirname(this.teamDir), { recursive: true });
      await this.gitOk(this.root, ['worktree', 'add', '-f', '-B', BRANCH, this.teamDir, `origin/${BRANCH}`], 'Could not check out the team context');
    } else {
      fs.mkdirSync(path.dirname(this.teamDir), { recursive: true });
      // a stale local branch from an earlier attempt would block the orphan
      await this.git.run(this.root, ['branch', '-D', BRANCH]);
      const [maj, min] = await this.gitVersion();
      if (maj > 2 || (maj === 2 && min >= 42)) {
        await this.gitOk(this.root, ['worktree', 'add', '-f', '--orphan', '-b', BRANCH, this.teamDir], 'Could not create the team context branch');
      } else {
        await this.gitOk(this.root, ['worktree', 'add', '-f', '--detach', this.teamDir], 'Could not create the team context worktree');
        await this.gitOk(this.teamDir, ['checkout', '--orphan', BRANCH], 'Could not create the team context branch');
        await this.git.run(this.teamDir, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.']);
        for (const name of fs.readdirSync(this.teamDir)) if (name !== '.git') fs.rmSync(path.join(this.teamDir, name), { recursive: true, force: true });
      }
      writeJson(path.join(this.teamDir, 'team.json'), { version: 1, project: this.project, createdBy: me.id, createdAt: iso(this.now()), takeoverAfterMinutes: TAKEOVER_MINUTES });
      fs.writeFileSync(path.join(this.teamDir, '.gitattributes'), '* text=auto eol=lf\n');
      await this.gitOk(this.teamDir, ['add', 'team.json', '.gitattributes'], 'Could not stage team.json');
      await this.gitOk(this.teamDir, [...await this.identityArgs(me), 'commit', '-q', '-m', `Vyuha team context for ${this.project || 'this project'}`], 'Could not commit team.json');
      const push = await this.net(this.teamDir, ['push', '-u', 'origin', `HEAD:refs/heads/${BRANCH}`]);
      if (push.code !== 0) {
        // someone else created it at the same moment: use theirs
        await this.git.run(this.root, ['worktree', 'remove', '--force', this.teamDir]);
        fs.rmSync(this.teamDir, { recursive: true, force: true });
        await this.git.run(this.root, ['worktree', 'prune']);
        await this.git.run(this.root, ['branch', '-D', BRANCH]);
        if (!_retry && isRejection(push)) return this.setup({ _retry: true });
        throw new Error(`Could not push the team context: ${this.git.errorText ? this.git.errorText(push) : push.stderr}`);
      }
      created = true;
    }
    this.saveSettings({ enabled: true, me, setupAt: iso(this.now()), created });
    this.importMine(me);
    return { created, state: await this.state() };
  }

  async pull() {
    await this.fetchBranch();
    await this.gitOk(this.teamDir, ['reset', '-q', '--hard', `origin/${BRANCH}`], 'Could not update the team context');
    await this.git.run(this.teamDir, ['clean', '-fdq']);
    this.importMine(await this.me());
    this.saveSettings({ lastPulled: iso(this.now()) });
    return this.state();
  }

  // Apply edits from the publish review: [{ id, title, symptom, cause, fix, include }]
  applyDrafts(drafts) {
    if (!Array.isArray(drafts) || !drafts.length) return;
    const list = this.localIssues();
    for (const d of drafts) {
      const i = list.find(x => x.id === d.id); if (!i) continue;
      for (const k of ['title', 'symptom', 'cause', 'fix', 'area']) if (typeof d[k] === 'string') i[k] = scrub(d[k], this.home);
      if (d.include !== undefined) i.include = !!d.include;
    }
    this.saveIssues(list);
  }

  // What a publish would send (for the review dialog)
  async pending() {
    const s = this.settings();
    const sent = s.publishedEvents || 0;
    const events = this.localEvents();
    return { newEvents: Math.max(0, events.length - sent), drafts: this.localIssues().filter(i => !i.published), shareStyle: !!s.shareStyle, lastPublished: s.lastPublished || null };
  }

  // opts: { drafts, shareStyle, style } (style = behaviour.exportStyle(), only used when shareStyle)
  async publish(opts = {}) {
    const me = await this.me();
    if (!this.worktreeReady()) throw new Error('Set up team context first.');
    this.applyDrafts(opts.drafts);
    const patch = {};
    if (opts.shareStyle !== undefined) patch.shareStyle = !!opts.shareStyle;
    if (opts.shareStyle && opts.style) patch.lastStyle = opts.style;
    if (opts.shareStyle === false) patch.lastStyle = null;
    this.saveSettings(patch);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.fetchBranch();
      await this.gitOk(this.teamDir, ['reset', '-q', '--hard', `origin/${BRANCH}`], 'Could not update the team context');
      await this.git.run(this.teamDir, ['clean', '-fdq']);
      const at = iso(this.now());
      this.importMine(me);   // another clone/machine of mine may have published since
      this.writeMine(me, at);
      const st = await this.state();
      // nothing of mine changed (the profile's updatedAt aside): no commit, TEAM.md is already current
      const mine = await this.git.run(this.teamDir, ['status', '--porcelain', '--', `people/${me.id}`]);
      const changed = mine.stdout.split('\n').filter(Boolean).map(l => l.slice(3).replace(/^"|"$/g, ''));
      if (changed.length && changed.every(f => /profile\.json$/.test(f)) && fs.existsSync(path.join(this.teamDir, 'TEAM.md'))) {
        await this.git.run(this.teamDir, ['checkout', '--', `people/${me.id}`]);
      }
      if (!changed.length || (changed.every(f => /profile\.json$/.test(f)) && fs.existsSync(path.join(this.teamDir, 'TEAM.md')))) {
        this.markPublished(at);
        return { ok: true, nothing: true, attempts: attempt, state: st };
      }
      fs.writeFileSync(path.join(this.teamDir, 'TEAM.md'), renderTeamMd({ ...st, publishedAt: at, publishedBy: me.id }));
      await this.gitOk(this.teamDir, ['add', '-A', '--', `people/${me.id}`, 'TEAM.md'], 'Could not stage the team context');
      const staged = await this.git.run(this.teamDir, ['diff', '--cached', '--quiet']);
      if (staged.code === 0) { this.markPublished(at); return { ok: true, nothing: true, attempts: attempt, state: st }; }
      await this.gitOk(this.teamDir, [...await this.identityArgs(me), 'commit', '-q', '-m', `Team context from ${me.name}`], 'Could not commit the team context');
      const push = await this.net(this.teamDir, ['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
      if (push.code === 0) { this.markPublished(at); return { ok: true, attempts: attempt, state: await this.state() }; }
      lastErr = push;
      if (!isRejection(push)) break;
    }
    throw new Error(`Could not publish the team context: ${lastErr && this.git.errorText ? this.git.errorText(lastErr) : 'GitHub kept rejecting the push'}`);
  }
  writeMine(me, at) {
    const dir = path.join(this.teamDir, 'people', me.id);
    // the union of what the branch already has for me and my local log: never fewer events than the branch
    const events = unionEvents(readJsonl(path.join(dir, 'events.jsonl')).filter(e => e && e.by === me.id), this.localEvents());
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, 'profile.json'), { id: me.id, name: me.name, email: me.email, updatedAt: at });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    writeJson(path.join(dir, 'issues.json'), this.localIssues().filter(i => i.include).map(i => this.card(i)));
    const s = this.settings();
    if (s.shareStyle && s.lastStyle) writeJson(path.join(dir, 'style.json'), s.lastStyle);
  }
  // Re-clone, new machine, deleted .vyuha, or a second clone of mine: bring any of my events and issue cards
  // that are on the branch but missing locally back into team-local (matched by id). Returns how many.
  importMine(me) {
    const dir = path.join(this.teamDir, 'people', me.id);
    const branchEvents = readJsonl(path.join(dir, 'events.jsonl')).filter(e => e && e.by === me.id && e.id);
    const local = this.localEvents();
    const have = new Set(local.map(e => e.id));
    const missing = branchEvents.filter(e => !have.has(e.id));
    if (missing.length) {
      const all = unionEvents(local, missing);
      fs.mkdirSync(this.localDir, { recursive: true });
      fs.writeFileSync(this.file('events.jsonl'), all.map(e => JSON.stringify(e) + '\n').join(''));
    }
    const cards = readJson(path.join(dir, 'issues.json'), []).filter(c => c && c.by === me.id && c.id);
    const issues = this.localIssues();
    const known = new Set(issues.map(i => i.id));
    const newCards = cards.filter(c => !known.has(c.id)).map(c => ({ ...c, published: true, include: true }));
    if (newCards.length) this.saveIssues([...issues, ...newCards]);
    if (missing.length && !this.settings().publishedEvents) this.saveSettings({ publishedEvents: branchEvents.length });
    return { events: missing.length, issues: newCards.length };
  }

  /* ---------- issues: detection and resolution ---------- */
  async dirtyFiles() {
    // paths relative to the project root (porcelain paths are relative to the repo top; strip our prefix)
    try {
      const pre = await this.git.run(this.root, ['rev-parse', '--show-prefix']);
      if (pre.code !== 0) return [];
      const prefix = pre.stdout.trim();
      const st = await this.git.run(this.root, ['status', '--porcelain=v1', '-uall']);
      return st.stdout.split('\n').filter(Boolean).map(l => { let f = l.slice(3); if (f.includes(' -> ')) f = f.split(' -> ')[1]; return f.replace(/^"|"$/g, ''); })
        .filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length)).filter(f => !f.startsWith('.vyuha'));
    } catch (e) { return []; }
  }
  // After any command (Gemini's or typed). Returns { issue, matches, resolved }.
  // opts.sourcesSince(ms) → URLs of project sources filed since then (optional)
  async afterCommand({ command, exitCode, output, phaseId = null, sourcesSince = null }) {
    const me = await this.me();
    const cmd = normaliseCommand(command);
    const list = this.localIssues();
    const at = iso(this.now());
    if (exitCode !== 0) {
      const sig = signature(output);
      let issue = list.find(i => i.status === 'open' && i.signature === sig && normaliseCommand(i.command) === cmd);
      if (issue) { issue.attempts++; issue.errorExcerpt = scrub(String(output || '').slice(-1500), this.home); issue.errorLines = errorBlock(output).map(l => scrub(l, this.home)); }
      else {
        const errorType = errorTypeOf(output);
        const firstErr = String(output || '').split(/\r?\n/).find(l => ERR_LINE.test(l)) || '';
        issue = { id: 'i-' + rand4(this.random) + rand4(this.random), status: 'open', published: false, include: false, by: me.id,
                  command: scrub(String(command).trim(), this.home), signature: sig, errorType, errorExcerpt: scrub(String(output || '').slice(-1500), this.home),
                  attempts: 1, openedAt: at, resolvedAt: null, filesChanged: [], sources: [], decisionIds: [], phaseId, area: '',
                  title: `${errorType || 'Error'} when running ${cmd}`, symptom: scrub(firstErr.trim().slice(0, 300), this.home), cause: '', fix: '',
                  errorLines: errorBlock(output).map(l => scrub(l, this.home)), dirtyAtOpen: await this.dirtyFiles(), written: [] };
        list.push(issue);
      }
      this.saveIssues(list);
      const all = await this.readAll();
      const others = all.issues.filter(i => i.by !== me.id);
      const matches = matchIssues(String(output || ''), command, issue.written, others)
        .map(m => ({ ...m, byName: (all.profiles[m.issue.by] || { name: m.issue.by }).name }));
      return { issue, matches, resolved: [] };
    }
    // success: open issues for the same command are fixed
    const open = list.filter(i => i.status === 'open' && normaliseCommand(i.command) === cmd);
    if (!open.length) return { issue: null, matches: [], resolved: [] };
    const dirty = await this.dirtyFiles();
    const mine = this.localEvents();
    for (const i of open) {
      const was = new Set(i.dirtyAtOpen || []);
      i.status = 'fixed';
      i.resolvedAt = at;
      i.filesChanged = [...new Set([...(i.written || []), ...dirty.filter(f => !was.has(f))])];
      i.decisionIds = [...new Set([...(i.decisionIds || []), ...mine.filter(e => e.type === 'decision_recorded' && e.at >= i.openedAt && e.at <= at).map(e => e.decisionId)])];
      if (sourcesSince) { try { i.sources = [...new Set([...(i.sources || []), ...(sourcesSince(Date.parse(i.openedAt)) || [])])]; } catch (e) { /* optional */ } }
      i.include = true;   // fixed issues are offered for publishing (the review can untick them)
    }
    this.saveIssues(list);
    return { issue: null, matches: [], resolved: open };
  }
  noteFileWritten(rel) {
    const list = this.localIssues();
    let changed = false;
    for (const i of list) if (i.status === 'open' && !(i.written || []).includes(rel)) { (i.written = i.written || []).push(rel); changed = true; }
    if (changed) this.saveIssues(list);
  }
  // A diff of every changed file, tracked or new (untracked), within `budget` characters in total.
  // Each file first gets an equal share; what small files leave over goes to the larger ones.
  async diffFor(files, budget = 8000) {
    const parts = [];
    for (const f of files || []) {
      const tracked = (await this.git.run(this.root, ['ls-files', '--error-unmatch', '--', f])).code === 0;
      const r = tracked ? await this.git.run(this.root, ['diff', 'HEAD', '--', f])
                        : await this.git.run(this.root, ['diff', '--no-index', '--', '/dev/null', f]);   // exit 1 = "there are differences"
      if (r.stdout) parts.push(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    }
    if (!parts.length) return '';
    const total = parts.reduce((n, p) => n + p.length, 0);
    if (total <= budget) return parts.join('');
    const cut = '\n…(diff cut to fit)\n';
    const alloc = parts.map(() => 0);
    let left = budget, open = parts.map((_, k) => k);
    while (left > 0 && open.length) {
      const share = Math.max(1, Math.floor(left / open.length));
      for (const k of open) { const take = Math.min(parts[k].length - alloc[k], share, left); alloc[k] += take; left -= take; }
      open = open.filter(k => alloc[k] < parts[k].length);
      if (share === 1) break;
    }
    const out = parts.map((p, k) => (alloc[k] >= p.length ? p : p.slice(0, Math.max(0, alloc[k] - cut.length)) + cut)).join('');
    return out.slice(0, budget);
  }

  // Ask Gemini (injected) for title/symptom/cause/fix. Inputs: never the user's prompts, only Gemini's replies and the diff.
  async writeUpIssue(id, { geminiReplies = [] } = {}) {
    if (!this.writeUp) return null;
    const list = this.localIssues();
    const i = list.find(x => x.id === id);
    if (!i) return null;
    const diff = await this.diffFor(i.filesChanged, 8000);
    const input = { command: i.command, errorExcerpt: i.errorExcerpt, filesChanged: i.filesChanged, diff: scrub(diff, this.home),
                    geminiReplies: (geminiReplies || []).map(r => scrub(String(r).slice(0, 4000), this.home)).slice(-6) };
    let out = null;
    try { out = await this.writeUp(input); } catch (e) { return null; }
    if (!out) return null;
    const fresh = this.localIssues();
    const j = fresh.find(x => x.id === id);
    for (const k of ['title', 'symptom', 'cause', 'fix']) if (out[k] && String(out[k]).trim()) j[k] = scrub(String(out[k]).trim().slice(0, 1200), this.home);
    this.saveIssues(fresh);
    return j;
  }

  markPublished(at) {
    const list = this.localIssues();
    for (const i of list) if (i.include) i.published = true;
    this.saveIssues(list);
    this.saveSettings({ lastPublished: at, publishedEvents: this.localEvents().length });
  }
}

/* ---------- what both command paths do after a command finishes ----------
   main.js and the tests call these same functions. tm = null (no team context) → nothing happens. */
const knowledgeOf = m => ({ title: m.issue.title, by: m.byName, when: m.issue.resolvedAt || m.issue.openedAt, status: m.issue.status,
                            cause: m.issue.cause, fix: m.issue.fix, files: m.issue.filesChanged || [], score: m.score, issueId: m.issue.id });

// Gemini's run_command. Returns { fields } to merge into the tool result, and writeUps (a promise) for resolved issues.
async function geminiCommandHook(tm, { command, result, step, phaseId, geminiReplies, sourcesSince }) {
  if (!tm) return { fields: {}, writeUps: Promise.resolve([]) };
  try {
    const out = await tm.afterCommand({ command, exitCode: result.code, output: result.output, phaseId, sourcesSince });
    const fields = {};
    if (out.matches.length) {
      fields.team_knowledge = out.matches.map(knowledgeOf);
      for (const m of out.matches) {
        if (step) step({ kind: 'team', label: `Team has seen this: ${m.issue.title} (${m.byName})`, doc: 'team:issue:' + m.issue.id });
      }
    }
    if (out.issue) fields.team_issue = { id: out.issue.id, attempts: out.issue.attempts };
    const writeUps = Promise.all(out.resolved.map(i => tm.writeUpIssue(i.id, { geminiReplies: typeof geminiReplies === 'function' ? geminiReplies(i) : geminiReplies })))
      .catch(e => { console.error('team write-up:', e); return []; });
    return { fields, writeUps, out };
  } catch (e) {
    console.error('team context (run_command):', e);
    return { fields: {}, writeUps: Promise.resolve([]) };
  }
}
// A command the user typed in the Terminal panel. notify(event) sends a UI event; never throws.
async function terminalCommandHook(tm, { command, result, notify, phaseId, geminiReplies, sourcesSince }) {
  if (!tm) return null;
  try {
    const out = await tm.afterCommand({ command, exitCode: result.code, output: result.output, phaseId, sourcesSince });
    if (out.matches.length && notify) notify({ kind: 'match', command, cards: out.matches.map(knowledgeOf) });
    if (out.resolved.length && notify) notify({ kind: 'resolved', issues: out.resolved.map(i => ({ id: i.id, title: i.title })) });
    await Promise.all(out.resolved.map(i => tm.writeUpIssue(i.id, { geminiReplies: typeof geminiReplies === 'function' ? geminiReplies(i) : geminiReplies || [] })));
    return out;
  } catch (e) {
    console.error('team context (terminal):', e);
    return null;
  }
}

// "Answer like <name>": blend a teammate's published style into my behaviour profile (undoable there)
async function importTeammateStyle(tm, behaviour, personId, weight = 0.5) {
  const st = await tm.state();
  const style = st.styles[personId];
  if (!style || personId === st.me.id) throw new Error('That teammate hasn’t shared an answer style.');
  return behaviour.importStyle(style, nameOf(st.fold, personId), weight);
}

module.exports = {
  BRANCH, TAKEOVER_MINUTES, Team, importTeammateStyle,
  normaliseCommand, signature, errorLines, errorBlock, errorTypeOf, matchIssues, normaliseLine, jaccard, sigTokens,
  geminiCommandHook, terminalCommandHook,
  slugId, eventId, makeEvent, newPhaseId, newTaskId, newDecisionId,
  fold, takeoverBlocked, nameOf, describeEvent, renderTeamMd,
  scrub, scrubDeep,
  readJson, writeJson, readJsonl
};
