// Projects on disk. Two kinds:
//   Vyuha projects   <projects dir>/<id>/project.json + chat.json, files in <id>/code/
//   Opened folders   any folder on your computer (File → Open Folder); its files are the
//                    folder itself, and Vyuha keeps its notes in <folder>/.vyuha/
const fs = require('fs');
const path = require('path');
const SEED = require('./seed');
const router = require('./router');

const IGNORE = new Set(['.git', 'node_modules', '.vyuha', '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode',
  'dist', 'build', '.DS_Store', '.next', '.cache', '.ipynb_checkpoints', '.pytest_cache', '.mypy_cache']);
const SHOW_DOTFILES = new Set(['.gitignore', '.env.example']);
const MAX_FILES = 3000;
const MAX_READ = 1024 * 1024;   // don't open files over 1 MB in the editor

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const stamp = () => {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
const toPosix = p => p.split(path.sep).join('/');
const normUrl = u => String(u).split('#')[0].replace(/\/$/, '');
// Source collections. The first three are built in (automatic filing uses them); users can add more.
const BUILT_IN = [{ id: 'dataset', name: 'datasets' }, { id: 'video', name: 'videos' }, { id: 'repo', name: 'repositories' }, { id: 'research', name: 'research' }];
const TASK = /^(\s*[-*]\s+)\[( |x|X)\]\s*(.*)$/;
const bare = ph => String(ph).replace(/^\d+-/, '');

class Store {
  constructor(dir, registryFile) {
    this.dir = dir;
    this.registryFile = registryFile;
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.readdirSync(dir).length) this.seed();
    this.cache = new Map();   // id -> project.json contents
    this.meta = new Map();    // id -> { metaDir, codeRoot, external }
    for (const id of fs.readdirSync(dir)) this._load(id, path.join(dir, id), path.join(dir, id, 'code'), false);
    for (const f of this.registry()) {
      if (fs.existsSync(f.path)) this._load(f.id, path.join(f.path, '.vyuha'), f.path, true);
    }
  }

  _load(id, metaDir, codeRoot, external) {
    const f = path.join(metaDir, 'project.json');
    if (!fs.existsSync(f)) return;
    try {
      const p = JSON.parse(fs.readFileSync(f, 'utf8'));
      p.id = id;
      p.events = p.events || []; p.decisions = p.decisions || []; p.phases = p.phases || ['1-planning'];
      p.phase = p.phase || p.phases[0];
      if (!p.collections || !p.collections.length) p.collections = BUILT_IN.map(c => ({ ...c }));
      // add any built-in collection an older project doesn't have yet (e.g. repositories), before research
      for (const b of BUILT_IN) if (!p.collections.some(c => c.id === b.id)) {
        const r = p.collections.findIndex(c => c.id === 'research');
        p.collections.splice(r < 0 ? p.collections.length : r, 0, { ...b });
      }
      // sources filed as research before dataset detection improved
      let moved = false;
      for (const e of p.events) {
        if (e.type === 'research' && !e.manualType && (router.isDataUrl(e.url) || router.looksLikeDataset(e.title))) { e.type = 'dataset'; moved = true; }
        else if (e.type === 'research' && !e.manualType && router.isRepoUrl(e.url)) { e.type = 'repo'; moved = true; }
      }
      if (moved) fs.writeFileSync(f, JSON.stringify(p, null, 2));
      this.cache.set(id, p);
      this.meta.set(id, { metaDir, codeRoot, external });
    } catch (e) { console.error(`Skipping ${f}: ${e.message}`); }
  }

  seed() {
    for (const p of SEED) {
      const { files, ...meta } = p;
      const d = path.join(this.dir, p.id);
      fs.mkdirSync(path.join(d, 'code'), { recursive: true });
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(d, 'code', name), content);
      fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify(meta, null, 2));
    }
  }

  /* ---------- opened folders ---------- */
  registry() {
    try { return JSON.parse(fs.readFileSync(this.registryFile, 'utf8')); } catch (e) { return []; }
  }
  openFolder(folder) {
    folder = path.resolve(folder);
    const reg = this.registry();
    const known = reg.find(f => f.path === folder);
    if (known && this.cache.has(known.id)) return known.id;
    let id = slug(path.basename(folder)) || 'folder', n = 2;
    while (this.cache.has(id) || reg.some(f => f.id === id && f.path !== folder)) id = `${slug(path.basename(folder)) || 'folder'}-${n++}`;
    const metaDir = path.join(folder, '.vyuha');
    if (!fs.existsSync(path.join(metaDir, 'project.json'))) {
      fs.mkdirSync(metaDir, { recursive: true });
      const p = { id, summary: '', keywords: [id, id.replace(/-/g, ' ')], phases: ['1-planning', '2-build', '3-deploy'],
                  phase: '1-planning', phaseNotes: {}, events: [], decisions: [], collections: BUILT_IN.map(c => ({ ...c })) };
      fs.writeFileSync(path.join(metaDir, 'project.json'), JSON.stringify(p, null, 2));
    }
    fs.writeFileSync(this.registryFile, JSON.stringify([...reg.filter(f => f.path !== folder), { id, path: folder }], null, 2));
    this._load(id, metaDir, folder, true);
    return id;
  }

  list() { return [...this.cache.values()]; }

  // Drop a project from Vyuha (files are handled by the caller)
  forget(pid) {
    const m = this.meta.get(pid);
    this.cache.delete(pid);
    this.meta.delete(pid);
    if (m && m.external) {
      const reg = this.registry().filter(f => f.id !== pid);
      fs.writeFileSync(this.registryFile, JSON.stringify(reg, null, 2));
    }
  }
  get(id) { return this.cache.get(id); }

  save(p) {
    const m = this.meta.get(p.id);
    this.cache.set(p.id, p);
    fs.mkdirSync(m.metaDir, { recursive: true });
    fs.writeFileSync(path.join(m.metaDir, 'project.json'), JSON.stringify(p, null, 2));
  }

  /* ---------- files ---------- */
  // Turn a project-relative path into an absolute one, refusing anything outside the project
  resolve(pid, rel) {
    const m = this.meta.get(pid);
    if (!m) throw new Error('Unknown project');
    const full = path.resolve(m.codeRoot, String(rel || '').replace(/^[/\\]+/, ''));
    if (full !== m.codeRoot && !full.startsWith(m.codeRoot + path.sep)) throw new Error(`"${rel}" is outside the project folder`);
    if (path.relative(m.codeRoot, full).split(path.sep).includes('.vyuha')) throw new Error('.vyuha is managed by Vyuha');
    return full;
  }
  root(pid) { const m = this.meta.get(pid); return m ? m.codeRoot : null; }

  tree(pid) {
    const root = this.root(pid);
    if (!root || !fs.existsSync(root)) return { nodes: [], files: [], truncated: false };
    const files = [];
    let truncated = false;
    const walk = dir => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
      entries = entries.filter(e => !IGNORE.has(e.name) && (!e.name.startsWith('.') || SHOW_DOTFILES.has(e.name)));
      entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
      const out = [];
      for (const e of entries) {
        if (files.length >= MAX_FILES) { truncated = true; break; }
        const full = path.join(dir, e.name);
        const rel = toPosix(path.relative(root, full));
        if (e.isDirectory()) out.push({ name: e.name, path: rel, dir: true, children: walk(full) });
        else if (e.isFile()) { files.push(rel); out.push({ name: e.name, path: rel }); }
      }
      return out;
    };
    return { nodes: walk(root), files, truncated };
  }
  codeFiles(pid) { return this.tree(pid).files; }

  readCode(pid, rel) {
    const full = this.resolve(pid, rel);
    const st = fs.statSync(full);
    if (st.size > MAX_READ) throw new Error(`${rel} is ${(st.size / 1048576).toFixed(1)} MB, too large to open`);
    const buf = fs.readFileSync(full);
    if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} looks like a binary file`);
    return buf.toString('utf8');
  }

  writeCode(pid, rel, content) {
    if (!String(rel || '').trim()) throw new Error('A file path is required');
    const full = this.resolve(pid, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, String(content));
    return toPosix(path.relative(this.root(pid), full));
  }

  full(pid) {
    const p = this.get(pid); if (!p) return null;
    const m = this.meta.get(pid);
    const t = this.tree(pid);
    return { ...p, codeFiles: t.files, tree: t.nodes, treeTruncated: t.truncated, folder: m.external ? m.codeRoot : m.metaDir,
             root: m.codeRoot, external: m.external };
  }

  create(name, goal) {
    const id = slug(name) || 'untitled-project';
    if (this.get(id)) throw new Error(`A project called ${id} already exists`);
    const d = path.join(this.dir, id);
    fs.mkdirSync(path.join(d, 'code'), { recursive: true });
    fs.writeFileSync(path.join(d, 'code', 'README.md'), `# ${id}\n\n${goal || ''}\n`);
    this.meta.set(id, { metaDir: d, codeRoot: path.join(d, 'code'), external: false });
    const p = {
      id, summary: goal || 'No goal written yet.', keywords: [id, id.replace(/-/g, ' ')],
      phases: ['1-planning', '2-build', '3-deploy'], phase: '1-planning',
      phaseNotes: { '1-planning': 'Project created.' }, events: [], decisions: [], collections: BUILT_IN.map(c => ({ ...c }))
    };
    this.save(p);
    return p;
  }

  /* ---------- editing the file tree ---------- */
  createFile(pid, rel) {
    const full = this.resolve(pid, rel);
    if (fs.existsSync(full)) throw new Error(`${rel} already exists`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
    return toPosix(path.relative(this.root(pid), full));
  }
  createDir(pid, rel) {
    const full = this.resolve(pid, rel);
    if (fs.existsSync(full)) throw new Error(`${rel} already exists`);
    fs.mkdirSync(full, { recursive: true });
    return toPosix(path.relative(this.root(pid), full));
  }
  renamePath(pid, from, to) {
    const a = this.resolve(pid, from), b = this.resolve(pid, to);
    if (a === this.root(pid)) throw new Error("The project folder itself can't be renamed here");
    if (!fs.existsSync(a)) throw new Error(`${from} no longer exists`);
    if (fs.existsSync(b)) throw new Error(`${to} already exists`);
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.renameSync(a, b);
    // sources that were "used in" the old path follow the rename
    const p = this.get(pid);
    for (const e of p.events) e.usedIn = (e.usedIn || []).map(u => (u === from ? to : u.startsWith(from + '/') ? to + u.slice(from.length) : u));
    this.save(p);
    return toPosix(path.relative(this.root(pid), b));
  }
  // full path for deletion (the caller moves it to the system Trash)
  deletable(pid, rel) {
    const full = this.resolve(pid, rel);
    if (full === this.root(pid)) throw new Error("The project folder itself can't be deleted here");
    if (!fs.existsSync(full)) throw new Error(`${rel} no longer exists`);
    return full;
  }

  /* ---------- source collections ---------- */
  collectionOf(pid, wanted) {
    const p = this.get(pid); if (!p) return 'research';
    const w = String(wanted || '').toLowerCase().trim();
    const c = p.collections.find(x => x.id === w || x.name.toLowerCase() === w || x.name.toLowerCase() === w + 's');
    return c ? c.id : null;
  }
  addCollection(pid, name) {
    const p = this.get(pid);
    name = String(name || '').trim();
    if (!name) throw new Error('A name is needed');
    if (p.collections.some(c => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a collection called ${name}`);
    let id = 'c-' + (slug(name) || 'collection'), n = 2;
    while (p.collections.some(c => c.id === id)) id = 'c-' + slug(name) + '-' + n++;
    p.collections.push({ id, name });
    this.save(p);
    return id;
  }
  renameCollection(pid, id, name) {
    const p = this.get(pid);
    const c = p.collections.find(x => x.id === id);
    name = String(name || '').trim();
    if (!c || !name) throw new Error('Nothing to rename');
    if (p.collections.some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a collection called ${name}`);
    c.name = name; this.save(p);
  }
  deleteCollection(pid, id) {
    const p = this.get(pid);
    if (BUILT_IN.some(b => b.id === id)) throw new Error('datasets, videos, repositories and research are built in and can be renamed but not deleted');
    const moved = p.events.filter(e => e.type === id);
    for (const e of moved) e.type = 'research';
    p.collections = p.collections.filter(c => c.id !== id);
    this.save(p);
    return moved.length;
  }

  /* ---------- phases ---------- */
  // keep phases numbered in order, updating everything that points at them
  _renumber(p, order) {
    const map = {};
    order.forEach((ph, i) => { map[ph] = `${i + 1}-${bare(ph)}`; });
    const notes = {};
    for (const [k, v] of Object.entries(p.phaseNotes || {})) if (map[k]) notes[map[k]] = v;
    p.phaseNotes = notes;
    for (const e of p.events) if (e.phase && map[e.phase]) e.phase = map[e.phase];
    for (const d of p.decisions) if (d.phase && map[d.phase]) d.phase = map[d.phase];
    p.phase = map[p.phase] || order.map(ph => map[ph])[0];
    p.phases = order.map(ph => map[ph]);
    return map;
  }
  addPhase(pid, name) {
    const p = this.get(pid);
    const b = slug(name);
    if (!b) throw new Error('A name is needed');
    if (p.phases.some(ph => bare(ph) === b)) throw new Error(`There is already a ${b} phase`);
    const ph = `${p.phases.length + 1}-${b}`;
    p.phases.push(ph); this.save(p);
    return ph;
  }
  renamePhase(pid, ph, name) {
    const p = this.get(pid);
    const b = slug(name);
    if (!b) throw new Error('A name is needed');
    if (p.phases.some(x => x !== ph && bare(x) === b)) throw new Error(`There is already a ${b} phase`);
    const i = p.phases.indexOf(ph); if (i < 0) throw new Error('Unknown phase');
    const order = [...p.phases];
    order[i] = `${i + 1}-${b}`;
    // move references to the new name first, then renumber
    if (p.phaseNotes && p.phaseNotes[ph] != null) { p.phaseNotes[order[i]] = p.phaseNotes[ph]; delete p.phaseNotes[ph]; }
    for (const e of p.events) if (e.phase === ph) e.phase = order[i];
    for (const d of p.decisions) if (d.phase === ph) d.phase = order[i];
    if (p.phase === ph) p.phase = order[i];
    p.phases = order;
    this._renumber(p, order);
    this.save(p);
    return p.phases[i];
  }
  movePhase(pid, ph, dir) {
    const p = this.get(pid);
    const i = p.phases.indexOf(ph), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= p.phases.length) return ph;
    const order = [...p.phases];
    [order[i], order[j]] = [order[j], order[i]];
    const map = this._renumber(p, order);
    this.save(p);
    return map[ph];
  }
  deletePhase(pid, ph) {
    const p = this.get(pid);
    if (p.phases.length <= 1) throw new Error('A project needs at least one phase');
    const i = p.phases.indexOf(ph); if (i < 0) throw new Error('Unknown phase');
    const keep = p.phases.filter(x => x !== ph);
    const into = keep[Math.max(0, i - 1)];
    for (const e of p.events) if (e.phase === ph) e.phase = into;
    for (const d of p.decisions) if (d.phase === ph) d.phase = into;
    if (p.phaseNotes) delete p.phaseNotes[ph];
    if (p.phase === ph) p.phase = into;
    this._renumber(p, keep);
    this.save(p);
  }
  // Replace the phases with a real plan: [{ name, goal, tasks: [..] }]. Sources and decisions
  // move to the phase with the same name, or to the first phase.
  setPlan(pid, phases, current) {
    const p = this.get(pid);
    const list = (phases || []).filter(x => x && x.name).slice(0, 10);
    if (!list.length) throw new Error('A plan needs at least one phase');
    const used = new Set();
    const order = list.map((x, i) => {
      let b = slug(x.name) || 'phase', n = 2;
      while (used.has(b)) b = `${slug(x.name) || 'phase'}-${n++}`;
      used.add(b);
      return `${i + 1}-${b}`;
    });
    const target = old => order.find(n => bare(n) === bare(old)) || order[0];
    for (const e of p.events) if (e.phase) e.phase = target(e.phase);
    for (const d of p.decisions) if (d.phase) d.phase = target(d.phase);
    const notes = {};
    list.forEach((x, i) => {
      const tasks = (x.tasks || []).filter(Boolean).map(t => `- [${x.done && x.done.includes(t) ? 'x' : ' '}] ${String(t).trim()}`);
      const before = Object.entries(p.phaseNotes || {}).find(([k, v]) => bare(k) === bare(order[i]) && v && v !== 'Project created.');
      notes[order[i]] = [x.goal && String(x.goal).trim(), tasks.join('\n'), before && `**Earlier notes**\n\n${before[1]}`].filter(Boolean).join('\n\n');
    });
    p.phases = order;
    p.phaseNotes = notes;
    const want = current ? slug(current).replace(/^\d+-/, '') : '';
    p.phase = order.find(n => bare(n) === want) || order[0];
    this.save(p);
    return order;
  }
  // Tick or untick a task. By position (from the checklist UI) or by its text (from Gemini).
  setTask(pid, phase, { index, text, done }) {
    const p = this.get(pid);
    const ph = phase || p.phase;
    if (!p.phases.includes(ph)) throw new Error(`Unknown phase ${ph}`);
    const lines = String((p.phaseNotes || {})[ph] || '').split('\n');
    let n = -1, hit = -1;
    const want = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    lines.forEach((l, i) => {
      const m = l.match(TASK); if (!m) return; n++;
      if (index != null ? n === index : (hit < 0 && want && (m[3].toLowerCase().includes(want) || want.includes(m[3].toLowerCase().trim())))) hit = i;
    });
    if (hit < 0) {
      if (index != null || !want) throw new Error('Task not found');
      lines.push(`- [${done ? 'x' : ' '}] ${String(text).trim()}`);   // a new task
    } else {
      const m = lines[hit].match(TASK);
      const val = done == null ? m[2] === ' ' : !!done;
      lines[hit] = `${m[1]}[${val ? 'x' : ' '}] ${m[3]}`;
    }
    (p.phaseNotes = p.phaseNotes || {})[ph] = lines.join('\n');
    this.save(p);
    return ph;
  }

  // Team context: make the local phases follow the folded team plan ([{ id, name, tasks }], in order).
  // syncNotes(oldNotes, tasks) only touches the checklist lines that belong to team tasks, so goals,
  // earlier notes and update_notes summaries stay exactly as they are. Local phases that aren't in the
  // team plan are kept at the end if they still have notes of their own, otherwise dropped.
  syncTeamPlan(pid, phases, syncNotes) {
    const p = this.get(pid);
    if (!p || !Array.isArray(phases) || !phases.length) return false;
    const before = JSON.stringify(p);
    const team = p.team = p.team || {};
    const map = team.phaseMap = team.phaseMap || {};
    const used = new Set();
    const name = (n, i) => { let b = slug(n) || 'phase', k = 2; while (used.has(b)) b = `${slug(n) || 'phase'}-${k++}`; used.add(b); return `${i + 1}-${b}`; };
    const order = phases.map((ph, i) => name(ph.name, i));
    const claimed = new Set();
    const rename = {};
    phases.forEach((ph, i) => {
      let old = map[ph.id];
      if (!old || !p.phases.includes(old) || claimed.has(old)) old = p.phases.find(x => !claimed.has(x) && !Object.values(map).includes(x) && bare(x) === bare(order[i]));
      if (old) { claimed.add(old); rename[old] = order[i]; }
    });
    const strip = v => String(v || '').split('\n').filter(l => !/<!--vt:[\w-]+-->/.test(l)).join('\n').trim();
    const kept = p.phases.filter(x => !claimed.has(x) && strip((p.phaseNotes || {})[x]) && strip((p.phaseNotes || {})[x]) !== 'Project created.');
    kept.forEach((x, j) => { rename[x] = name(bare(x), order.length + j); });
    const all = [...order, ...kept.map(x => rename[x])];
    const into = all[0];
    const target = old => rename[old] || into;
    for (const e of p.events) if (e.phase) e.phase = target(e.phase);
    for (const d of p.decisions) if (d.phase) d.phase = target(d.phase);
    const notes = {};
    phases.forEach((ph, i) => {
      const old = Object.keys(rename).find(k => rename[k] === order[i]);
      notes[order[i]] = syncNotes(old != null ? (p.phaseNotes || {})[old] || '' : '', ph.tasks || []);
    });
    for (const x of kept) notes[rename[x]] = p.phaseNotes[x];
    p.phaseNotes = notes;
    p.phase = target(p.phase);
    p.phases = all;
    team.phaseMap = Object.fromEntries(phases.map((ph, i) => [ph.id, order[i]]));
    if (JSON.stringify(p) === before) return false;
    this.save(p);
    return true;
  }

  setCurrentPhase(pid, ph) {
    const p = this.get(pid);
    if (!p.phases.includes(ph)) throw new Error('Unknown phase');
    p.phase = ph; this.save(p);
  }

  /* ---------- sources, decisions, phases ---------- */
  addEvent(pid, ev) {
    const p = this.get(pid);
    if (!p) return null;
    const e = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                time: stamp(), phase: p.phase, status: 'kept', usedIn: [], ...ev };
    p.events.push(e);
    this.save(p);
    return e;
  }
  hasUrl(pid, url) { const p = this.get(pid); return !!p && p.events.some(e => normUrl(e.url) === normUrl(url)); }
  updateEvent(pid, eid, patch) {
    const p = this.get(pid); const e = p && p.events.find(x => x.id === eid);
    if (!e) return;
    Object.assign(e, patch); this.save(p);
  }
  deleteEvent(pid, eid) {
    const p = this.get(pid); if (!p) return;
    p.events = p.events.filter(e => e.id !== eid); this.save(p);
  }
  linkSources(pid, urls, file) {
    const p = this.get(pid); if (!p || !Array.isArray(urls)) return [];
    const want = new Set(urls.map(normUrl));
    const hit = p.events.filter(e => want.has(normUrl(e.url)));
    for (const e of hit) { e.usedIn = e.usedIn || []; if (file && !e.usedIn.includes(file)) e.usedIn.push(file); }
    this.save(p);
    return hit.map(e => e.id);
  }
  addDecision(pid, title, detail, urls) {
    const p = this.get(pid); if (!p) return null;
    const ids = this.linkSources(pid, urls || [], null);
    const d = { title, detail, phase: p.phase, time: stamp(), sources: ids };
    p.decisions.push(d); this.save(p);
    return d;
  }
  // Write or extend a phase's notes without moving the project
  setPhaseNote(pid, phase, note, append) {
    const p = this.get(pid); if (!p) return null;
    if (!p.phases.includes(phase)) p.phases.push(phase);
    const notes = (p.phaseNotes = p.phaseNotes || {});
    const old = notes[phase] && notes[phase] !== 'Project created.' ? notes[phase] : '';
    notes[phase] = append && old ? `${old}\n\n${note}` : note;
    this.save(p);
    return phase;
  }

  setPhase(pid, phase, note) {
    const p = this.get(pid); if (!p) return null;
    if (!p.phases.includes(phase)) p.phases.push(phase);
    p.phase = phase;
    if (note) (p.phaseNotes = p.phaseNotes || {})[phase] = note;
    this.save(p);
    return p.phase;
  }

  /* ---------- Gemini chat ---------- */
  readChat(pid) {
    const m = this.meta.get(pid);
    try { return JSON.parse(fs.readFileSync(path.join(m.metaDir, 'chat.json'), 'utf8')); }
    catch (e) { return { transcript: [], history: [] }; }
  }
  writeChat(pid, chat) {
    const m = this.meta.get(pid); if (!m) return;
    fs.mkdirSync(m.metaDir, { recursive: true });
    fs.writeFileSync(path.join(m.metaDir, 'chat.json'), JSON.stringify(chat, null, 1));
  }
}

module.exports = { Store, slug, BUILT_IN };
