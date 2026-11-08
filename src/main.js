// Vyuha main process.
// The window shows Vyuha's own UI (renderer/). Each tab can hold a web page: a
// WebContentsView, a real Chromium page drawn over the "page slot" that the UI
// reserves for it. Because it isn't an iframe, sites like YouTube load normally.
//
// A tab is either general browsing or inside a project. A project tab works like
// VS Code: folders on the left, editor/page in the middle, a terminal underneath
// and Gemini on the right. Every page a project tab visits is filed into the project.
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, safeStorage, dialog, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const router = require('./router');
const { Store } = require('./store');
const { Terminals } = require('./terminal');
const agent = require('./agent');
const { Behaviour } = require('./behaviour');
const git = require('./git');
const { Team, takeoverBlocked, describeEvent } = require('./team');
const teamPlan = require('./team-plan');
const teamHooks = require('./team');

let win, store, settings, terms, behaviour;
let slot = null;           // where the UI wants the web page drawn: {x, y, width, height}
let overlayOpen = false;   // hide web pages while a Vyuha dialog or menu is open
const tabs = [];
let activeId = null;
let seq = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

/* ---------- settings ---------- */
const DEFAULT_SETTINGS = { logResearch: true, logDatasets: true, logVideos: true,
                           model: 'gemini-3.8-flash', fallbackModel: 'gemini-3.5-flash-lite' };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
const captureOn = type => (type === 'dataset' ? settings.logDatasets : type === 'video' ? settings.logVideos : settings.logResearch);

/* ---------- Gemini API key ----------
   Kept only in the main process, encrypted with the OS keychain (safeStorage).
   GEMINI_API_KEY in the environment takes priority if set. */
const secretFile = name => path.join(app.getPath('userData'), `${name}.key`);
function loadSecret(name) {
  try {
    const j = JSON.parse(fs.readFileSync(secretFile(name), 'utf8'));
    const buf = Buffer.from(j.data, 'base64');
    return j.enc ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch (e) { return null; }
}
function saveSecret(name, value) {
  if (!value) { try { fs.unlinkSync(secretFile(name)); } catch (e) { /* none saved */ } return; }
  const enc = safeStorage.isEncryptionAvailable();
  const data = enc ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
  fs.writeFileSync(secretFile(name), JSON.stringify({ enc, data: data.toString('base64') }), { mode: 0o600 });
}
const loadKey = () => process.env.GEMINI_API_KEY || loadSecret('gemini');
const saveKey = key => saveSecret('gemini', key);
// GitHub personal access token (GITHUB_TOKEN in the environment also works)
const gitToken = () => process.env.GITHUB_TOKEN || loadSecret('github');
/* ---------- team context (only for projects where it is set up) ---------- */
const teams = new Map();   // root -> Team
function makeTeam(pid) {
  const root = store.root(pid);
  if (!root) return null;
  let t = teams.get(root);
  if (!t) {
    t = new Team({ root, project: pid, git, token: gitToken,
      identity: async () => { const u = await githubApi('/user').catch(() => null); return u ? { name: u.name || u.login, email: `${u.id}+${u.login}@users.noreply.github.com` } : null; },
      writeUp: input => { const apiKey = loadKey(); return apiKey ? agent.extractIssue({ apiKey, model: settings.model, ...input }) : null; } });
    teams.set(root, t);
  }
  return t;
}
const teamFor = pid => { const root = store && store.root(pid); return root && Team.isEnabled(root) ? makeTeam(pid) : null; };
const opsFor = pid => teamPlan.planOps(store, pid, teamFor(pid));
const sendTeam = (pid, kind, data = {}) => send('team', { pid, kind, ...data });
const teamCommandContext = pid => teamPlan.commandContext(store, pid);
// Run a team-aware operation; an action the fold refuses becomes a toast and an error for Gemini
async function teamTry(pid, fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof teamPlan.Rejected) { sendTeam(pid, 'rejected', { reason: e.message }); return { error: e.message, rejected: true }; }
    throw e;
  }
}

function agentStatus() {
  const k = loadKey();
  return { hasKey: !!k, fromEnv: !!process.env.GEMINI_API_KEY, hint: k ? '…' + k.slice(-4) : null, model: settings.model };
}

/* ---------- tabs and pages ----------
   A tab is one entry in the top tab strip. Inside a project it holds several
   pages (web pages, each with its own Chromium view), shown as editor tabs.
   pane: 'start' = Vyuha home (plain tab) or the project's Gemini home
         'web'   = the tab's active page
         'doc'   = something from the project: 'file:<path>' opens the editor;
                   'event:<id>', 'phase:<p>', 'decisions' are notes */
const active = () => tabs.find(t => t.id === activeId);
const pageOf = t => (t && t.pages.find(p => p.id === t.pageId)) || null;
const projOf = pg => (pg.worker ? pg.project : pg.tab && pg.tab.project);
const normUrl = u => String(u || '').split('#')[0].replace(/\/$/, '');
let pageSeq = 0;

function makeTab(project = null) {
  const t = { id: 't' + (++seq), project, pane: 'start', pages: [], pageId: null, docPath: null, answer: null };
  const i = tabs.findIndex(x => x.id === activeId);
  tabs.splice(i + 1, 0, t);
  return t;
}

function newPage(t) {
  const pg = { id: 'p' + (++pageSeq), tab: t, view: null, title: '', url: '', loading: false, logged: [], lastKey: null };
  t.pages.push(pg);
  t.pageId = pg.id;
  return pg;
}

function destroyPage(pg) {
  if (!pg.view) return;
  try { win.contentView.removeChildView(pg.view); } catch (e) { /* not attached */ }
  try { pg.view.webContents.close(); } catch (e) { /* already closed */ }
  pg.view = null;
}
function destroyPages(t) { for (const pg of t.pages) destroyPage(pg); t.pages = []; t.pageId = null; }

function closePage(t, pageId) {
  const i = t.pages.findIndex(p => p.id === pageId); if (i < 0) return;
  destroyPage(t.pages[i]);
  t.pages.splice(i, 1);
  if (t.pageId === pageId) {
    const next = t.pages[Math.min(i, t.pages.length - 1)];
    t.pageId = next ? next.id : null;
    if (t.pane === 'web' && !next) t.pane = 'start';
  }
  layout(); broadcast();
}

function ensureView(pg) {
  if (pg.view) return;
  const view = new WebContentsView({
    webPreferences: { partition: 'persist:vyuha-web', sandbox: true, contextIsolation: true }
  });
  pg.view = view;
  const wc = view.webContents;
  wc.on('did-start-loading', () => { pg.loading = true; broadcast(); });
  wc.on('did-stop-loading', () => { pg.loading = false; broadcast(); });
  wc.on('did-navigate', (_e, url) => onNavigate(pg, url));
  // single-page sites (YouTube) change the URL without a full load
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) onNavigate(pg, url); });
  wc.on('page-title-updated', (_e, title) => {
    pg.title = title;
    const pid = projOf(pg);
    const last = pg.logged[pg.logged.length - 1];
    if (last && pid && last.url === pg.url) {
      const patch = { title };
      // a page titled "… Dataset" on an unknown site is still a dataset
      const ev = (store.get(pid) || { events: [] }).events.find(e => e.id === last.id);
      if (ev && ev.type === 'research' && router.looksLikeDataset(title)) patch.type = 'dataset';
      store.updateEvent(pid, last.id, patch);
    }
    broadcast();
  });
  // links that open a new window: a new page in the same project, or a new tab
  wc.setWindowOpenHandler(({ url }) => {
    if (pg.worker) return { action: 'deny' };   // Gemini's background browser never opens tabs
    const t = pg.tab;
    if (t.project) { loadInTab(t, url, { newPage: true, why: 'Opened from a link while browsing this project' }); activeId = t.id; }
    else { const n = makeTab(); loadInTab(n, url, {}); activeId = n.id; }
    layout(); broadcast();
    return { action: 'deny' };
  });
}

// The provenance log: every page a project page visits is filed into that project.
function onNavigate(pg, url) {
  pg.url = url;
  const key = url.split('#')[0];
  const pid = projOf(pg);
  if (pid && key !== pg.lastKey && /^https?:/.test(url) && !router.isLocal(url)) {
    if (pg.skipNext) pg.skipNext = false;
    else if (store.hasUrl(pid, url)) { /* already filed */ }
    else {
      const type = router.classify(url);
      if (captureOn(type)) {
        const ev = store.addEvent(pid, {
          type, title: url, url, tool: pg.worker ? 'gemini' : 'browser', query: pg.query || null,
          why: pg.why || 'Visited while browsing in this project'
        });
        if (ev) pg.logged.push({ id: ev.id, url });
        pg.why = null;
      }
    }
  }
  pg.lastKey = key;
  broadcast();
}

function loadPage(pg, url, o = {}) {
  ensureView(pg);
  Object.assign(pg, { query: o.query || null, why: o.why || null, skipNext: !!o.skipFirst, requested: url });
  if (!pg.url) pg.title = url;
  pg.view.webContents.loadURL(url);
}

// Load a URL in tab t: in its current page, or a new page when o.newPage is set
function loadInTab(t, url, o = {}) {
  const pg = o.newPage || !pageOf(t) ? newPage(t) : pageOf(t);
  t.pageId = pg.id;
  t.pane = 'web';
  t.answer = null;
  loadPage(pg, url, o);
  return pg;
}

// Open a project source: switch to it if it's already open, otherwise open it in a new page
function openSource(t, url) {
  const open = t.pages.find(p => normUrl(p.url) === normUrl(url) || normUrl(p.requested) === normUrl(url));
  if (open) { t.pageId = open.id; t.pane = 'web'; }
  else loadInTab(t, url, { newPage: true, skipFirst: true });
  layout(); broadcast();
}

function openProject(pid, answer) {
  if (!store.get(pid)) return;
  let t = tabs.find(x => x.project === pid);
  if (!t) {
    const a = active();
    t = a && !a.project && a.pane === 'start' ? a : makeTab();
    t.project = pid;
    t.pane = 'start';
  }
  if (answer) { t.answer = answer; t.pane = 'start'; }
  activeId = t.id;
  layout(); broadcast();
}

function closeProject() {
  const a = active(); if (!a || !a.project) return;
  destroyPages(a);
  Object.assign(a, { project: null, pane: 'start', answer: null, docPath: null });
  layout(); broadcast();
}

// Home button: inside a project, back to the project's Gemini home; otherwise the Vyuha home page
function goHome() {
  const a = active(); if (!a) return;
  if (a.project) { a.pane = 'start'; a.answer = null; }
  else { destroyPages(a); a.pane = 'start'; }
  layout(); broadcast();
}

function newTab() {
  const t = makeTab();
  activeId = t.id;
  layout(); broadcast();
  send('ui', 'focus-search');
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id); if (i < 0) return;
  destroyPages(tabs[i]);
  tabs.splice(i, 1);
  if (!tabs.length) { const t = makeTab(); activeId = t.id; }
  else if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)].id;
  layout(); broadcast();
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const r = slot || { x: 0, y: 92, width: w, height: h - 92 };
  for (const t of tabs) {
    for (const pg of t.pages) {
      if (!pg.view) continue;
      const show = t.id === activeId && t.pane === 'web' && t.pageId === pg.id && !overlayOpen && r.width > 0 && r.height > 0;
      const attached = win.contentView.children.includes(pg.view);
      if (show) {
        if (!attached) win.contentView.addChildView(pg.view);
        pg.view.setBounds({ x: r.x, y: r.y, width: Math.min(r.width, w - r.x), height: Math.min(r.height, h - r.y) });
      } else if (attached) win.contentView.removeChildView(pg.view);
    }
  }
}

async function openFolderDialog() {
  const res = await dialog.showOpenDialog(win, { title: 'Open Folder', properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return;
  try {
    const id = store.openFolder(res.filePaths[0]);
    buildMenu();
    openProject(id);
  } catch (e) { dialog.showErrorBox('Could not open folder', e.message); }
}

/* ---------- previewing project files (like VS Code's Live Preview) ---------- */
// Opens an HTML file from the project as a page. Local files are never filed as sources.
function previewFile(pid, rel) {
  const a = active();
  if (!a || a.project !== pid) return { error: 'Open the project first.' };
  let url;
  try { url = pathToFileURL(store.resolve(pid, rel)).href; } catch (e) { return { error: e.message }; }
  const open = a.pages.find(p => normUrl(p.url) === normUrl(url));
  if (open) { a.pageId = open.id; a.pane = 'web'; open.view.webContents.reloadIgnoringCache(); }
  else loadInTab(a, url, { newPage: true });
  layout(); broadcast();
  return { ok: true };
}
// After a file in the project is saved, reload any page previewing that project's files
function reloadPreviews(pid) {
  const root = store.root(pid);
  if (!root) return;
  const prefix = pathToFileURL(root).href;
  for (const t of tabs) for (const pg of t.pages) if (pg.view && (pg.url || '').startsWith(prefix)) pg.view.webContents.reloadIgnoringCache();
}

/* ---------- the Gemini agent ---------- */
// Each project gets a hidden browser that Gemini uses. Its pages go through the
// same onNavigate() filing as yours, so everything Gemini opens becomes a source.
const workers = new Map();
const running = new Set();
const approvals = new Map();   // approval id -> { resolve, step, pid, chat }
let approvalSeq = 0;

// YouTube and Google show a cookie-consent page to new visitors in the UK/EU. For Gemini's
// background searches, answer it with "reject non-essential cookies" (SOCS=CAI) so results load.
async function rejectConsent(ses) {
  for (const domain of ['.youtube.com', '.google.com']) {
    const url = `https://www${domain}`;
    const have = await ses.cookies.get({ url, name: 'SOCS' }).catch(() => []);
    if (!have.length) await ses.cookies.set({ url, domain, name: 'SOCS', value: 'CAI', path: '/', secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400 }).catch(() => {});
  }
}

function worker(pid) {
  let w = workers.get(pid);
  if (!w) {
    w = { id: 'w-' + pid, worker: true, project: pid, view: null, logged: [], lastKey: null, title: '', url: '' };
    workers.set(pid, w);
  }
  if (!w.view) { ensureView(w); w.view.webContents.setBackgroundThrottling(false); }
  return w;
}

const READ_PAGE = limit => `(() => {
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${limit});
  const seen = new Set(), links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const t = (a.innerText || a.title || a.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    if (!t || !/^https?:/.test(a.href) || seen.has(a.href)) continue;
    seen.add(a.href); links.push({ text: t, href: a.href });
    if (links.length >= 60) break;
  }
  return { url: location.href, title: document.title, text, links };
})()`;

async function browse(pid, url, reason, query) {
  const w = worker(pid);
  w.why = reason ? `Opened by Gemini: ${reason}` : 'Opened by Gemini while working on this project';
  w.query = query || null;
  const wc = w.view.webContents;
  await Promise.race([wc.loadURL(url).catch(() => {}), sleep(20000)]);
  await sleep(1500);   // let script-built pages (YouTube, Hugging Face) render
  const page = await Promise.race([wc.executeJavaScript(READ_PAGE(12000), true).catch(() => null), sleep(6000).then(() => null)]);
  return page || { url, error: 'Could not load or read this page.' };
}

// Load a page in Gemini's background browser without filing it (search results pages are noise)
async function loadQuiet(pid, url) {
  const w = worker(pid);
  w.skipNext = true;
  const wc = w.view.webContents;
  await rejectConsent(wc.session);
  await Promise.race([wc.loadURL(url).catch(() => {}), sleep(20000)]);
  return wc;
}

// Specific YouTube videos: read YouTube's own result data (ytInitialData) from the results page
const YT_RESULTS = `(() => {
  const out = [], seen = new Set();
  const txt = t => !t ? '' : t.simpleText || (t.runs || []).map(r => r.text).join('');
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || out.length >= 12 || depth > 40) return;
    const v = o.videoRenderer;
    if (v && v.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push({ title: txt(v.title), url: 'https://www.youtube.com/watch?v=' + v.videoId, channel: txt(v.ownerText),
                 length: txt(v.lengthText), views: txt(v.viewCountText), published: txt(v.publishedTimeText) });
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  walk(window.ytInitialData, 0);
  if (!out.length) for (const a of document.querySelectorAll('a#video-title, a#video-title-link')) {
    if (out.length >= 12) break;
    if (a.href && a.href.includes('/watch')) out.push({ title: a.textContent.trim(), url: a.href.split('&')[0] });
  }
  return out;
})()`;
async function findVideos(pid, query) {
  const wc = await loadQuiet(pid, `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  for (let i = 0; i < 4; i++) {   // the result data can take a moment to appear
    await sleep(1200);
    const list = await wc.executeJavaScript(YT_RESULTS, true).catch(() => []);
    if (list && list.length) return list;
  }
  return [];
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Vyuha' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
// GitHub's public search API (no login needed; about 10 searches a minute)
async function findRepos(query) {
  const j = await getJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`);
  return (j.items || []).map(r => ({ title: r.full_name, url: r.html_url, stars: r.stargazers_count, language: r.language,
                                     description: (r.description || '').slice(0, 200), updated: (r.pushed_at || '').slice(0, 10) }));
}
// Hugging Face's public dataset API, plus Kaggle's dataset search page
async function findDatasets(pid, query) {
  const out = { huggingface: [], kaggle: [] };
  try {
    const j = await getJson(`https://huggingface.co/api/datasets?search=${encodeURIComponent(query)}&limit=8&sort=downloads&direction=-1`);
    out.huggingface = (j || []).map(d => ({ title: d.id, url: `https://huggingface.co/datasets/${d.id}`, downloads: d.downloads, likes: d.likes }));
  } catch (e) { out.huggingfaceError = e.message; }
  try {
    const wc = await loadQuiet(pid, `https://www.kaggle.com/datasets?search=${encodeURIComponent(query)}`);
    await sleep(2500);
    out.kaggle = await wc.executeJavaScript(`(() => {
      const seen = new Set(), list = [];
      for (const a of document.querySelectorAll('a[href*="/datasets/"]')) {
        const m = a.href.match(/^https:\\/\\/www\\.kaggle\\.com\\/datasets\\/[^/?#]+\\/[^/?#]+$/);
        const t = (a.innerText || a.getAttribute('aria-label') || '').trim().split('\\n')[0];
        if (!m || !t || seen.has(a.href)) continue;
        seen.add(a.href); list.push({ title: t.slice(0, 120), url: a.href });
        if (list.length >= 8) break;
      }
      return list;
    })()`, true).catch(() => []);
  } catch (e) { out.kaggleError = e.message; }
  return out;
}

const enc = encodeURIComponent;
const SEARCH_URL = {
  web: q => `https://html.duckduckgo.com/html/?q=${enc(q)}`,
  youtube: q => `https://www.youtube.com/results?search_query=${enc(q)}`,
  huggingface_datasets: q => `https://huggingface.co/datasets?search=${enc(q)}`,
  kaggle: q => `https://www.kaggle.com/datasets?search=${enc(q)}`,
  github: q => `https://github.com/search?q=${enc(q)}&type=repositories`,
  stackoverflow: q => `https://stackoverflow.com/search?q=${enc(q)}`,
  arxiv: q => `https://arxiv.org/search/?query=${enc(q)}&searchtype=all`,
  wikipedia: q => `https://en.wikipedia.org/w/index.php?search=${enc(q)}`
};
const SITE_NAME = { web: 'the web', youtube: 'YouTube', huggingface_datasets: 'Hugging Face Datasets', kaggle: 'Kaggle',
  github: 'GitHub', stackoverflow: 'Stack Overflow', arxiv: 'arXiv', wikipedia: 'Wikipedia' };
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const tail = (s, n) => (s.length > n ? `…(${s.length - n} earlier characters omitted)\n` + s.slice(-n) : s);

function agentTools(pid, step, ctx) {
  const remember = list => { for (const x of list || []) if (x && x.url) ctx.found.set(normUrl(x.url), x.title); };
  const tools = {
    find_videos: async ({ query }) => {
      step({ kind: 'search', label: `Searched YouTube for "${query}"`, url: `https://www.youtube.com/results?search_query=${enc(query)}` });
      const videos = await findVideos(pid, query);
      remember(videos);
      return videos.length ? { videos } : { videos: [], note: 'No results could be read from YouTube right now.' };
    },
    find_repos: async ({ query }) => {
      step({ kind: 'search', label: `Searched GitHub for "${query}"`, url: `https://github.com/search?q=${enc(query)}&type=repositories` });
      const repos = await findRepos(query);
      remember(repos);
      return { repos };
    },
    find_datasets: async ({ query }) => {
      step({ kind: 'search', label: `Searched Hugging Face and Kaggle for "${query}"`, url: `https://huggingface.co/datasets?search=${enc(query)}` });
      const r = await findDatasets(pid, query);
      remember(r.huggingface); remember(r.kaggle);
      return r;
    },
    set_plan: async ({ phases, current }) => {
      const order = await opsFor(pid).setPlan(phases, current);
      ctx.planSet = true;
      step({ kind: 'phase', label: `Planned ${order.length} phases: ${order.map(o => o.replace(/^\d+-/, '')).join(' → ')}`, doc: 'phase:' + store.get(pid).phase });
      broadcast();
      return { ok: true, phases: order, current: store.get(pid).phase };
    },
    update_task: async ({ phase, task, done }) => {
      const p = store.get(pid);
      const ph = phase ? (p.phases.find(x => x === phase || x.replace(/^\d+-/, '') === String(phase).replace(/^\d+-/, '')) || phase) : p.phase;
      const r = await teamTry(pid, () => opsFor(pid).updateTask(ph, task, done !== false));
      if (r.error) return r;
      step({ kind: 'phase', label: `${done === false ? 'Reopened' : 'Done'}: ${task}`, doc: 'phase:' + (r.phase || ph) });
      broadcast();
      return { ok: true, phase: r.phase || ph };
    },
    search_web: async ({ site, query, reason }) => {
      const url = (SEARCH_URL[site] || SEARCH_URL.web)(query);
      step({ kind: 'search', label: `Searched ${SITE_NAME[site] || 'the web'} for "${query}"`, url });
      return browse(pid, url, reason, query);
    },
    open_page: async ({ url, reason }) => {
      if (!/^https?:\/\//i.test(url)) return { error: 'Only http(s) URLs can be opened.' };
      step({ kind: 'open', label: `Read ${hostOf(url)}`, url });
      return browse(pid, url, reason);
    },
    read_file: async ({ path: rel }) => {
      step({ kind: 'read', label: `Read ${rel}`, doc: 'file:' + rel });
      return { path: rel, content: store.readCode(pid, rel) };
    },
    write_file: async ({ path: rel, content, source_urls }) => {
      const saved = store.writeCode(pid, rel, content);
      // datasets downloaded in code (URLs to .csv/.zip files, Kaggle/UCI/HF pages) are filed too
      const urls = String(content).match(/https?:\/\/[^\s'"`)<>\]]+/g) || [];
      for (const u of new Set(urls)) {
        if (!router.isDataUrl(u) || store.hasUrl(pid, u)) continue;
        store.addEvent(pid, { type: 'dataset', title: u.split('?')[0].split('/').slice(-2).join('/'), url: u, tool: 'gemini',
                              why: `Downloaded in ${saved}`, usedIn: [saved] });
        step({ kind: 'source', label: `Filed dataset ${hostOf(u)}`, url: u });
        ctx.filedDataset = true;
      }
      store.linkSources(pid, [...(source_urls || []), ...urls], saved);
      step({ kind: 'write', label: `Wrote ${saved}`, doc: 'file:' + saved });
      try { const tm = teamFor(pid); if (tm) tm.noteFileWritten(saved); } catch (e) { console.error('team context:', e); }
      send('file-changed', { pid, path: saved });
      reloadPreviews(pid);
      broadcast();
      return { ok: true, path: saved, bytes: Buffer.byteLength(String(content)) };
    },
    run_command: async ({ command, reason, timeout_seconds }) => {
      // Every command waits for the user's approval in the Gemini panel
      const id = 'a' + (++approvalSeq);
      const s = { kind: 'approve', id, command, reason, status: 'waiting', label: command };
      step(s);
      send('ui', 'open-gemini');
      const ok = await new Promise(resolve => approvals.set(id, { resolve }));
      approvals.delete(id);
      behaviour.note(pid, ok ? 'approved' : 'denied');
      s.status = ok ? 'approved' : 'skipped';
      ctx.save();
      if (!ok) return { skipped: true, note: 'The user chose not to run this command.' };
      send('ui', 'open-terminal');
      const secs = Math.min(Math.max(Number(timeout_seconds) || 120, 5), 900);
      try {
        const r = await terms.run(pid, store.root(pid), command, { timeoutMs: secs * 1000, by: 'gemini' });
        s.exit = r.code;
        ctx.save();
        // team context: open/fix issue cards, and show a teammate's fix for a known error (no-op without team context)
        const t = await teamHooks.geminiCommandHook(teamFor(pid), { command, result: r, step, ...teamCommandContext(pid) });
        t.writeUps.then(list => { if (list.some(Boolean)) sendTeam(pid, 'changed'); });
        return { exit_code: r.code, stopped: !!r.signal, output: tail(r.output, 6000), ...t.fields };
      } catch (e) { s.exit = 'error'; ctx.save(); return { error: e.message }; }
    },
    record_source: async ({ url, title, type, why }) => {
      ctx.recorded.add(normUrl(url || ''));
      if (!/^https?:\/\//i.test(url || '')) return { error: 'A full http(s) URL is needed.' };
      const kind = store.collectionOf(pid, type) || router.classify(url);
      if (kind === 'dataset') ctx.filedDataset = true;
      const p = store.get(pid);
      const existing = p.events.find(e => normUrl(e.url) === normUrl(url));
      if (existing) store.updateEvent(pid, existing.id, { type: kind, title: title || existing.title, why: why || existing.why });
      else store.addEvent(pid, { type: kind, title: title || url, url, tool: 'gemini', why: why || 'Chosen by Gemini' });
      step({ kind: 'source', label: `Filed ${kind}: ${title || hostOf(url)}`, url });
      broadcast();
      return { ok: true, folder: (store.get(pid).collections.find(c => c.id === kind) || { name: kind }).name };
    },
    update_notes: async ({ phase, note, append }) => {
      const p = store.get(pid);
      const ph = String(phase || p.phase).trim();
      await opsFor(pid).updateNotes(ph, note, !!append);
      step({ kind: 'phase', label: `Updated ${ph}.md`, doc: 'phase:' + ph });
      broadcast();
      return { ok: true, phase: ph };
    },
    record_decision: async ({ title, detail, source_urls, area }) => {
      const d = await teamTry(pid, () => opsFor(pid).recordDecision(title, detail, source_urls, area));
      if (d && d.error) return d;
      if (d && d.teamId) ctx.decisions = [...(ctx.decisions || []), d.teamId];
      step({ kind: 'decision', label: `Recorded decision: ${title}`, doc: 'decisions' });
      broadcast();
      return { ok: true };
    },
    set_phase: async ({ phase, note }) => {
      const ph = store.setPhase(pid, String(phase).trim(), note);
      step({ kind: 'phase', label: `Moved to phase ${ph}`, doc: 'phase:' + ph });
      broadcast();
      return { ok: true, phase: ph };
    }
  };
  // team context only: claim the task Gemini is about to work on
  if (teamFor(pid)) {
    tools.claim_task = async ({ phase, task }) => {
      const r = await teamTry(pid, () => opsFor(pid).claimTask(phase, task));
      if (r.error) return r;
      step({ kind: 'phase', label: `Claimed: ${task}`, doc: 'phase:' + (r.phase || store.get(pid).phase) });
      broadcast();
      return { ok: true, phase: r.phase, owner: r.owner };
    };
  }
  return tools;
}

const notifyAgent = pid => send('agent', pid);

// Does this URL load? Some sites refuse automated requests (403/429) but still exist.
async function urlWorks(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const res = await net.fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    return res.status < 400 || res.status === 403 || res.status === 429;
  } catch (e) { return false; }
}

// Safety net: the reply talked about datasets but none were filed, so file what it named
// Is a YouTube video real? oEmbed answers 404 for made-up video ids, and gives us the title.
async function youtubeTitle(url) {
  try { const j = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`); return j.title || ''; }
  catch (e) { return null; }
}
const SEARCH_PAGE = /(google\.[a-z.]+\/search|youtube\.com\/results|duckduckgo\.com|github\.com\/search|bing\.com\/search|kaggle\.com\/datasets\?|huggingface\.co\/datasets\?)/i;

// Safety net: file every page Gemini recommended in its reply (videos, repos, datasets, docs)
async function fileReplyLinks(pid, question, reply, ctx, step) {
  const links = new Map();   // url -> link text
  for (const m of reply.matchAll(/\[([^\]]{1,160})\]\((https?:\/\/[^\s)]+)\)/g)) links.set(m[2], m[1]);
  for (const m of reply.matchAll(/https?:\/\/[^\s<>()\]]+[^\s<>().,;:!?'"\]]/g)) if (!links.has(m[0])) links.set(m[0], '');
  let n = 0;
  for (const [raw, text] of links) {
    if (n >= 15) break;
    const url = raw.replace(/&amp;/g, '&');
    const key = normUrl(url);
    if (SEARCH_PAGE.test(url) || router.isLocal(url) || store.hasUrl(pid, url) || ctx.recorded.has(key)) continue;
    let title = text || ctx.found.get(key) || '';
    const type = router.classify(url);
    if (type === 'video' && /youtube\.com\/watch|youtu\.be\//.test(url)) {
      const t = await youtubeTitle(url);
      if (t === null) continue;   // not a real video
      title = title || t;
    } else if (!ctx.found.has(key) && !(await urlWorks(url))) continue;
    if (!title) {
      try {
        const u = new URL(url);
        title = type === 'repo' ? u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')
                                : u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
      } catch (e) { title = url; }
    }
    if (!captureOn(type === 'repo' ? 'research' : type)) continue;
    store.addEvent(pid, { type, status: 'suggested', title, url, tool: 'gemini', query: question, why: 'Recommended by Gemini in the chat' });
    if (type === 'dataset') ctx.filedDataset = true;
    step({ kind: 'source', label: `Filed ${colName(pid, type)}: ${title}`, url });
    n++;
  }
  if (n) broadcast();
}
const colName = (pid, id) => ((store.get(pid).collections || []).find(c => c.id === id) || { name: id }).name;

// Safety net: the reply laid out a roadmap but no plan was saved, so turn it into phases
async function savePlanFromReply(pid, question, reply, apiKey, step) {
  const plan = await agent.extractPlan({ apiKey, model: settings.model, question, reply });
  if (!plan || !plan.phases || plan.phases.length < 2) return;
  const order = await opsFor(pid).setPlan(plan.phases, plan.current);
  step({ kind: 'phase', label: `Planned ${order.length} phases: ${order.map(o => o.replace(/^\d+-/, '')).join(' → ')}`, doc: 'phase:' + store.get(pid).phase });
  broadcast();
}
const hasTasks = p => Object.values(p.phaseNotes || {}).some(v => /^\s*[-*]\s+\[( |x|X)\]/m.test(v || ''));
const PLAN_INTENT = /\b(plan|roadmap|steps?|phases?|build|create|make|develop|how (do|to|should)|where (do|should) i start|get started)\b/i;

async function fileMentionedDatasets(pid, question, reply, apiKey, step) {
  const list = await agent.extractDatasets({ apiKey, model: settings.model, question, reply });
  const p = store.get(pid);
  const known = new Set(p.events.map(e => (e.title || '').toLowerCase()));
  let n = 0;
  for (const d of list) {
    if (known.has(String(d.name).toLowerCase())) continue;
    let url = /^https?:\/\//i.test(d.url || '') ? d.url : null;
    let note = '';
    if (!url || !(await urlWorks(url))) {
      url = `https://www.google.com/search?q=${encodeURIComponent(d.name + ' dataset')}`;
      note = ' (link not confirmed, opens a search)';
    }
    if (store.hasUrl(pid, url)) continue;
    store.addEvent(pid, { type: 'dataset', status: 'suggested', title: d.name, url, tool: 'gemini',
                          query: question, why: `Suggested by Gemini: ${d.why || 'mentioned in the chat'}${note}` });
    step({ kind: 'source', label: `Filed suggested dataset: ${d.name}`, url });
    n++;
  }
  if (n) broadcast();
}

// What the user is looking at, so "this" in a question makes sense
async function viewNote(pid, view) {
  const t = tabs.find(x => x.id === activeId);
  if (!view || !t || t.project !== pid) return '';
  if (view.kind === 'file' && view.path) {
    let content = typeof view.content === 'string' ? view.content : null;
    if (content == null) { try { content = store.readCode(pid, view.path); } catch (e) { content = ''; } }
    return `[The user has ${view.path} open in the editor${view.dirty ? ' with unsaved edits, shown here' : ''}:]\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\`\n\n`;
  }
  const pg = pageOf(t);
  if (view.kind === 'page' && pg && pg.view) {
    const page = await Promise.race([pg.view.webContents.executeJavaScript(READ_PAGE(4000), true).catch(() => null), sleep(3000).then(() => null)]);
    if (page) return `[The user is viewing the web page "${page.title}" (${page.url}). Page text, excerpt:]\n${page.text}\n\n`;
  }
  return '';
}

// How the user is working right now: is this an early, exploring phase of the project?
function behaviourContext(pid, mode) {
  const p = store.get(pid);
  if (!p) return { mode };
  const i = p.phases.indexOf(p.phase);
  return { mode, earlyPhase: i <= 0 || /plan|idea|research|explor|scop|discover|understand/i.test(p.phase || '') };
}
let analysing = false;
async function runBehaviourAnalysis() {
  const apiKey = loadKey();
  if (!apiKey || analysing) return { error: apiKey ? 'Already running.' : 'Add your Gemini API key in Settings first.' };
  analysing = true;
  try {
    const res = await agent.analyseBehaviour({ apiKey, model: settings.model, summary: behaviour.analystInput() });
    const added = behaviour.applyAnalysis(res);
    send('behaviour', behaviour.summary());
    return { ok: true, added };
  } catch (e) { return { error: agent.friendlyError(e, settings.model) }; }
  finally { analysing = false; }
}

async function askAgent(pid, text, view, extra = {}) {
  const apiKey = loadKey();
  if (!apiKey) return { error: 'Add your Gemini API key in Settings first.' };
  if (!store.get(pid)) return { error: 'Unknown project.' };
  if (running.has(pid)) return { error: 'Gemini is still working on the last request.' };
  running.add(pid);
  const chat = store.readChat(pid);
  const mode = chat.mode === 'build' ? 'build' : 'teach';
  const entry = { role: 'agent', steps: [], text: '', pending: true, at: Date.now(), mode };
  // decide how to answer from how the user is working (numbers only; see behaviour.js)
  let decision = null;
  try {
    decision = behaviour.begin(pid, text, { typing: extra.typing, reading: extra.reading, context: behaviourContext(pid, mode), override: extra.style });
    if (decision && decision.source !== 'off') {
      entry.style = { style: decision.style, wouldBe: decision.wouldBe || null, source: decision.source, confidence: decision.confidence, label: decision.label,
                      matched: (decision.matched || []).map(m => m.text) };
      const borrowed = (decision.matched || []).find(m => m.from && m.style === decision.style);
      if (borrowed) entry.style.from = borrowed.from;   // shown as "from <name>'s pattern"
    }
  } catch (e) { console.error('behaviour:', e); }
  chat.transcript.push({ role: 'user', text, at: Date.now(), viewing: view && (view.path || view.title) || null }, entry);
  const save = () => { store.writeChat(pid, chat); notifyAgent(pid); };
  const ctx = { save, filedDataset: false, planSet: false, found: new Map(), recorded: new Set() };
  save();
  const step = s => { entry.steps.push(s); save(); };
  try {
    const paths = store.codeFiles(pid);
    const files = [];
    for (const rel of paths.slice(0, 40)) {
      try { const c = store.readCode(pid, rel); if (c.length < 20000) files.push({ name: rel, content: c }); } catch (e) { /* binary or large */ }
      if (files.length >= 12) break;
    }
    const message = (await viewNote(pid, view)) + text;
    // team context: fresh plan from teammates, a Team section and the claim_task tool
    let teamSection = '', toolDecls;
    if (teamFor(pid)) {
      try { teamSection = teamPlan.teamPromptSection(await opsFor(pid).sync()); toolDecls = agent.teamTools(); }
      catch (e) { console.error('team context:', e); }
    }
    const res = await agent.run({
      apiKey, model: settings.model, fallbackModel: settings.fallbackModel, project: store.full(pid), files, paths,
      history: chat.history, message, tools: agentTools(pid, step, ctx),
      onNotice: label => step({ kind: 'info', label }),
      mode, toolDecls, teamSection,
      style: decision && decision.directive,
      onText: text => {   // streamed reply: save at most ~6 times a second
        entry.text = text;
        const now = Date.now();
        if (!entry.lastSave || now - entry.lastSave > 160) { entry.lastSave = now; save(); }
      }
    });
    delete entry.lastSave;
    entry.text = res.text;
    chat.history = agent.trimHistory(res.history);
    // safety nets, in case the model answered in prose without using its tools
    try { await fileReplyLinks(pid, text, res.text, ctx, step); }
    catch (e) { step({ kind: 'info', label: `Couldn't file the links in the reply: ${e.message}` }); }
    if (!ctx.filedDataset && /\b(data ?sets?|corpus|corpora)\b/i.test(text + ' ' + res.text)) {
      try { await fileMentionedDatasets(pid, text, res.text, apiKey, step); }
      catch (e) { step({ kind: 'info', label: `Couldn't file the datasets mentioned: ${agent.friendlyError(e, settings.model)}` }); }
    }
    const numbered = (res.text.match(/^\s*(\d+[.)]|#{1,4}\s*(step|phase)\b)/gim) || []).length;
    if (!ctx.planSet && !hasTasks(store.get(pid)) && numbered >= 3 && PLAN_INTENT.test(text)) {
      try { await savePlanFromReply(pid, text, res.text, apiKey, step); }
      catch (e) { step({ kind: 'info', label: `Couldn't save the plan: ${agent.friendlyError(e, settings.model)}` }); }
    }
  } catch (e) {
    entry.error = agent.friendlyError(e, settings.model);
  } finally {
    entry.pending = false;
    for (const s of entry.steps) if (s.status === 'waiting') s.status = 'skipped';
    save();
    running.delete(pid);
    broadcast();
    if (behaviour.needsAnalysis()) runBehaviourAnalysis().catch(() => {});
  }
  return { ok: !entry.error };
}

/* ---------- source control and GitHub ---------- */
async function githubApi(pathname, { method = 'GET', body, token } = {}) {
  const tok = token || gitToken();
  if (!tok) throw new Error('Add a GitHub token in Settings first.');
  const res = await net.fetch('https://api.github.com' + pathname, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'User-Agent': 'Vyuha',
               'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const extra = Array.isArray(j.errors) ? ` (${j.errors.map(e => e.message || e.code).join(', ')})` : '';
    if (res.status === 401) throw new Error('GitHub rejected the token. It may have expired; create a new one in Settings → GitHub.');
    if (res.status === 403 && /not accessible by (personal access|integration)/i.test(j.message || '')) {
      throw new Error(pathname.startsWith('/user/repos')
        ? 'Your GitHub token isn\u2019t allowed to create repositories. Use a classic token with the "repo" permission, or give your fine-grained token Administration and Contents: Read and write (Settings → GitHub explains how).'
        : 'Your GitHub token doesn\u2019t have permission for this. Use a classic token with the "repo" permission.');
    }
    if (res.status === 422 && /name already exists/i.test(extra)) throw new Error('You already have a GitHub repository with that name. Pick another name.');
    throw new Error(`GitHub: ${j.message || res.status}${extra}`);
  }
  return j;
}
// Commits need a name and email. If git has none, use the GitHub account (with its private noreply email).
async function ensureIdentity(cwd) {
  if (!gitToken()) return false;
  const u = await githubApi('/user').catch(() => null);
  if (!u) return false;
  await git.run(cwd, ['config', 'user.name', u.name || u.login]);
  await git.run(cwd, ['config', 'user.email', `${u.id}+${u.login}@users.noreply.github.com`]);
  return true;
}
async function commitAll(cwd, message) {
  await git.run(cwd, ['add', '-A']);
  let r = await git.run(cwd, ['commit', '-m', message]);
  if (git.errorText(r) === 'NEEDS_IDENTITY') {
    if (!(await ensureIdentity(cwd))) throw new Error('Git needs your name and email for commits. Add a GitHub token in Settings, or run in the Terminal panel: git config --global user.name "Your Name" && git config --global user.email you@example.com');
    r = await git.run(cwd, ['commit', '-m', message]);
  }
  if (r.code !== 0) throw new Error(/nothing to commit/i.test(r.stdout) ? 'There are no changes to commit.' : git.errorText(r));
}
async function gitOp(pid, op, a = {}) {
  const cwd = store.root(pid);
  if (!cwd) throw new Error('Unknown project');
  const token = gitToken();
  const out = {};
  switch (op) {
    case 'init': {
      let r = await git.run(cwd, ['init', '-b', 'main']);
      if (r.code) r = await git.run(cwd, ['init']);   // older git without -b
      if (r.code) throw new Error(git.errorText(r));
      await git.excludeVyuha(cwd);
      break;
    }
    case 'commit': {
      const msg = String(a.message || '').trim();
      if (!msg) throw new Error('Write a commit message first');
      await commitAll(cwd, msg);
      break;
    }
    case 'pull': {
      const r = await git.run(cwd, ['pull', '--ff-only'], { token });
      if (r.code) throw new Error(git.errorText(r));
      out.message = /Already up to date/i.test(r.stdout) ? 'Already up to date' : 'Pulled the latest changes';
      break;
    }
    case 'push': {
      const st = await git.status(cwd);
      if (!st.remote) throw new Error('This repository isn’t connected to GitHub yet. Use Publish to GitHub.');
      const r = await git.run(cwd, st.upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'], { token });
      if (r.code) throw new Error(git.errorText(r));
      break;
    }
    case 'show': {   // the committed version of a file, for the diff view
      const r = await git.run(cwd, ['show', `HEAD:./${a.path}`]);
      out.content = r.code === 0 ? r.stdout : '';
      return out;
    }
    case 'publish': {
      const name = String(a.name || pid).trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || pid;
      let st = await git.status(cwd);
      if (st.remote) throw new Error('This repository already has a remote. Use Push.');
      const repo = await githubApi('/user/repos', { method: 'POST', body: { name, private: a.private !== false, description: (store.get(pid).summary || '').slice(0, 300) } });
      if (!st.repo || !st.rootIsProject) { await gitOp(pid, 'init'); st = await git.status(cwd); }
      await git.excludeVyuha(cwd);
      if (st.noCommits) await commitAll(cwd, 'Initial commit');
      await git.run(cwd, ['remote', 'add', 'origin', repo.clone_url]);
      const r = await git.run(cwd, ['push', '-u', 'origin', 'HEAD'], { token });
      if (r.code) throw new Error(git.errorText(r));
      out.url = repo.html_url;
      break;
    }
    case 'gitignore': {
      const file = path.join(cwd, '.gitignore');
      const lines = ['__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.env', '.ipynb_checkpoints/', '.DS_Store', '.vyuha/'];
      let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { /* new file */ }
      const missing = lines.filter(l => !text.split('\n').map(x => x.trim()).includes(l));
      if (missing.length) fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
      // stop tracking anything already committed that is now ignored
      await git.run(cwd, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '__pycache__']);
      break;
    }
    case 'suggestMessage': {
      const apiKey = loadKey();
      if (!apiKey) throw new Error('Add your Gemini key in Settings to write commit messages.');
      const st = await git.status(cwd);
      const diff = st.noCommits ? '' : (await git.run(cwd, ['diff', 'HEAD'])).stdout;
      const added = st.files.filter(f => f.code === 'U' || st.noCommits).slice(0, 6).map(f => {
        let body = ''; try { body = store.readCode(pid, f.path).slice(0, 1500); } catch (e) { /* binary */ }
        return `New file ${f.path}:\n${body}`;
      }).join('\n\n');
      out.message = await agent.commitMessage({ apiKey, model: settings.model, changes: st.files.map(f => `${f.code} ${f.path}`).join('\n'), diff: diff.slice(0, 14000), added });
      return out;
    }
    default: throw new Error('Unknown action');
  }
  return out;
}

async function cloneRepo(input) {
  let url = String(input || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;   // owner/repo
  if (!/^(https?:\/\/|git@)/.test(url)) return { error: 'Enter a repository URL, e.g. https://github.com/owner/repo' };
  const pick = await dialog.showOpenDialog(win, { title: 'Choose where to put the cloned folder', buttonLabel: 'Clone Here', properties: ['openDirectory', 'createDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return { cancelled: true };
  const name = (url.split(/[/:]/).pop() || 'repo').replace(/\.git$/, '');
  const target = path.join(pick.filePaths[0], name);
  if (fs.existsSync(target)) return { error: `${target} already exists` };
  const r = await git.run(pick.filePaths[0], ['clone', url, name], { token: gitToken(), timeout: 600000 });
  if (r.code) return { error: git.errorText(r) };
  await git.excludeVyuha(target);
  const id = store.openFolder(target);
  buildMenu(); openProject(id);
  return { ok: true, id };
}

// Delete a project, asking first with the system dialog
async function deleteProject(pid) {
  pid = pid || (active() && active().project);
  if (!pid || !store.get(pid)) return { cancelled: true };
  if (running.has(pid)) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Gemini is still working in this project', detail: 'Wait for it to finish, then try again.' });
    return { cancelled: true };
  }
  const m = store.meta.get(pid);
  let choice;
  if (!m.external) {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1,
      message: `Delete the project "${pid}"?`,
      detail: `Its files, sources, plan and Gemini chat move to the Trash, where you can restore them:\n${m.metaDir}` });
    if (r.response !== 0) return { cancelled: true };
    choice = 'trash';
  } else {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Remove from Vyuha', 'Move Folder to Trash', 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Remove "${pid}" from Vyuha?`,
      detail: `Remove from Vyuha keeps the folder and all its files:\n${m.codeRoot}\nVyuha's notes stay in its .vyuha folder, so opening the folder again restores the project.\n\nMove Folder to Trash deletes the whole folder.` });
    if (r.response === 2) return { cancelled: true };
    choice = r.response === 0 ? 'forget' : 'trash';
  }
  // close everything that uses the project
  for (const t of tabs) if (t.project === pid) { destroyPages(t); Object.assign(t, { project: null, pane: 'start', docPath: null, answer: null }); }
  terms.stop(pid);
  const w = workers.get(pid); if (w) { destroyPage(w); workers.delete(pid); }
  try { if (choice === 'trash') await shell.trashItem(m.external ? m.codeRoot : m.metaDir); }
  catch (e) { dialog.showErrorBox('Could not move the project to the Trash', e.message); return { error: e.message }; }
  store.forget(pid);
  buildMenu(); layout(); broadcast();
  return { ok: true };
}

/* ---------- answering project questions without Gemini ---------- */
function answerLocally(pid, text) {
  const p = store.get(pid);
  const base = { q: text, at: Date.now(), refs: [] };
  if (/\b(why|decid|decision|chose|choose|pick)/i.test(text)) {
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const decs = p.decisions || [];
    const d = decs.find(x => words.some(w => (x.title + ' ' + x.detail).toLowerCase().includes(w))) || decs[decs.length - 1];
    if (!d) return { ...base, title: 'No decisions recorded yet', body: 'When a decision is made it will be added to decisions.md with the sources behind it.' };
    return { ...base, title: d.title, body: d.detail, refs: d.sources || [] };
  }
  const i = p.phases.indexOf(p.phase);
  const next = p.phases[i + 1];
  return { ...base, title: `Phase ${i + 1} of ${p.phases.length}: ${p.phase}`,
           body: `${(p.phaseNotes || {})[p.phase] || ''}${next ? ` Next up: ${next}.` : ''}`.trim() };
}

/* ---------- prompts from a search bar ---------- */
function handlePrompt(text) {
  text = String(text || '').trim();
  if (!text) return { kind: 'none' };
  const a = active();
  const fromProject = !!(a && a.project);
  // searching from inside a project always belongs to that project
  const det = fromProject
    ? { pid: a.project, why: 'it was searched from inside the project' }
    : router.detectProject(text, store.list());
  const { r, kw } = router.route(text);

  if (det && !kw && !router.looksLikeUrl(text) && router.AGENT_INTENT.test(text)) {
    if (loadKey()) {   // Gemini is connected: ask it in the project's Gemini panel
      openProject(det.pid);
      const t = active(); if (t) { t.pane = 'start'; layout(); broadcast(); }
      askAgent(det.pid, text, null);
      return { kind: 'agent', pid: det.pid };
    }
    const ans = answerLocally(det.pid, text);
    if (a && a.project === det.pid) { a.answer = ans; a.pane = 'start'; layout(); broadcast(); }
    else openProject(det.pid, ans);
    return { kind: 'answer', pid: det.pid };
  }

  let url, q = null;
  if (router.looksLikeUrl(text)) url = router.toUrl(text);
  else { q = router.cleanQuery(text, r); url = r.url(q); }

  // the home page navigates in place; inside a project it opens a new page; otherwise a new tab
  const t = a && (a.project ? a.project === det?.pid : a.pane === 'start') ? a : makeTab(det ? det.pid : null);
  if (det) t.project = det.pid;
  loadInTab(t, url, { newPage: !!t.project, query: q, why: det ? `Opened from the search bar ("${text}"). Filed because ${det.why}.` : null });
  activeId = t.id;
  layout(); broadcast();
  return { kind: 'web', site: q ? r.name : url, filed: det ? det.pid : null, fromProject };
}

// Address bar: a URL goes there directly; anything else is routed like a prompt.
function navigate(text) {
  const a = active();
  text = String(text || '').trim();
  if (!text) return;
  const pg = pageOf(a);
  if (a && a.pane === 'web' && pg && pg.view) {
    let url;
    if (router.looksLikeUrl(text)) url = router.toUrl(text);
    else { const { r } = router.route(text); pg.query = router.cleanQuery(text, r); url = r.url(pg.query); }
    pg.view.webContents.loadURL(url);
    return { kind: 'web' };
  }
  return handlePrompt(text);
}

/* ---------- state sent to the UI ---------- */
function history(pg, dir) {
  if (!pg || !pg.view) return false;
  const wc = pg.view.webContents, h = wc.navigationHistory;
  if (h) return dir === 'back' ? h.canGoBack() : h.canGoForward();
  return dir === 'back' ? wc.canGoBack() : wc.canGoForward();
}
function snapshot() {
  return {
    activeId,
    tabs: tabs.map(t => {
      const pg = pageOf(t);
      return {
        id: t.id, project: t.project, pane: t.pane, docPath: t.docPath, answer: t.answer,
        title: pg ? pg.title : '', url: pg ? pg.url : '', loading: !!(pg && pg.loading), hasView: !!(pg && pg.view),
        pageId: t.pageId, pages: t.pages.map(p => ({ id: p.id, title: p.title, url: p.url, loading: p.loading })),
        loggedCount: t.pages.reduce((n, p) => n + p.logged.length, 0),
        canBack: t.pane === 'web' ? history(pg, 'back') : !!pg,
        canForward: t.pane === 'web' && history(pg, 'forward')
      };
    }),
    projects: store.list().map(p => ({ id: p.id, summary: p.summary, phase: p.phase, events: p.events.length })),
    running: [...running],
    settings
  };
}
function broadcast() { send('state', snapshot()); if (win && store) refreshMenu(); }

/* ---------- menu ---------- */
// The File menu depends on what's open: rebuild it when the active project or editor changes
let menuKey = null;
function menuContext() {
  const a = active();
  return { pid: a && a.project, editing: !!(a && a.project && a.pane === 'doc' && (a.docPath || '').startsWith('file:')) };
}
function refreshMenu() {
  const c = menuContext();
  const key = `${c.pid || ''}|${c.editing}|${store.list().map(p => p.id).join(',')}`;
  if (key !== menuKey) buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const ctx = menuContext();
  menuKey = `${ctx.pid || ''}|${ctx.editing}|${store.list().map(p => p.id).join(',')}`;
  const projectItems = ctx.pid ? [
    { type: 'separator' },
    { label: `Close Project \u201c${ctx.pid}\u201d`, click: closeProject },
    { label: `Delete Project \u201c${ctx.pid}\u201d\u2026`, click: () => deleteProject(ctx.pid) }
  ] : [];
  const ui = msg => () => send('ui', msg);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: newTab },
      { label: 'New Project…', accelerator: 'CmdOrCtrl+Shift+N', click: ui('new-project') },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: openFolderDialog },
      { label: 'Clone Repository…', click: () => send('ui', 'clone') },
      { label: 'Open Project', submenu: store.list().length ? store.list().map(p => ({ label: p.id, click: () => openProject(p.id) })) : [{ label: 'No projects yet', enabled: false }] },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', enabled: ctx.editing, click: ui('save') },
      ...projectItems,
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeId) },
      ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])
    ] },
    { role: 'editMenu' },
    { label: 'Settings', submenu: [
      { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: ui('settings') },
      { label: 'How Vyuha Sees You…', click: ui('behaviour') }
    ] },
    { label: 'View', submenu: [
      { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: ui('focus-address') },
      { label: 'Toggle Project Folders', accelerator: 'CmdOrCtrl+B', click: ui('toggle-sidebar') },
      { label: 'Toggle Terminal', accelerator: 'CmdOrCtrl+J', click: ui('toggle-terminal') },
      { label: 'Toggle Gemini', accelerator: 'CmdOrCtrl+I', click: ui('toggle-gemini') },
      { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: () => { const a = active(); const pg = pageOf(a); if (pg && pg.view && a.pane === 'web') pg.view.webContents.reload(); } },
      { type: 'separator' },
      { label: 'Developer Tools (Vyuha UI)', accelerator: 'CmdOrCtrl+Alt+I', click: () => win.webContents.toggleDevTools() },
      { role: 'togglefullscreen' }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- IPC ---------- */
function wireIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('prompt', (_e, text) => handlePrompt(text));
  ipcMain.handle('navigate', (_e, text) => navigate(text));
  ipcMain.on('tab:new', newTab);
  ipcMain.on('tab:close', (_e, id) => closeTab(id));
  ipcMain.on('tab:activate', (_e, id) => { if (tabs.some(t => t.id === id)) { activeId = id; layout(); broadcast(); } });
  // pane 'web' takes an optional page id; 'doc' takes the doc path
  ipcMain.on('tab:pane', (_e, pane, arg) => {
    const a = active(); if (!a) return;
    if (pane === 'web') {
      const id = arg || a.pageId;
      if (!a.pages.some(p => p.id === id)) return;
      a.pageId = id;
    }
    a.pane = pane;
    if (pane === 'doc') a.docPath = arg;
    layout(); broadcast();
  });
  ipcMain.on('page:close', (_e, pageId) => { const a = active(); if (a) closePage(a, pageId); });
  ipcMain.on('nav:back', () => {
    const a = active(); const pg = pageOf(a); if (!pg || !pg.view) return;
    if (a.pane !== 'web') { a.pane = 'web'; layout(); broadcast(); }
    else pg.view.webContents.navigationHistory.goBack();
  });
  ipcMain.on('nav:forward', () => { const a = active(); const pg = pageOf(a); if (pg && pg.view && a.pane === 'web') pg.view.webContents.navigationHistory.goForward(); });
  ipcMain.on('nav:reload', () => { const a = active(); const pg = pageOf(a); if (pg && pg.view && a.pane === 'web') pg.view.webContents.reload(); });
  ipcMain.on('nav:home', goHome);
  ipcMain.on('project:open', (_e, pid) => openProject(pid));
  ipcMain.on('project:close', closeProject);
  ipcMain.on('project:openFolder', openFolderDialog);
  ipcMain.handle('project:get', (_e, pid) => store.full(pid));
  ipcMain.handle('file:read', (_e, pid, rel) => {
    try { return { content: store.readCode(pid, rel) }; } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('file:write', (_e, pid, rel, content) => {
    try { const saved = store.writeCode(pid, rel, content); reloadPreviews(pid); broadcast(); return { ok: true, path: saved }; }
    catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('file:preview', (_e, pid, rel) => previewFile(pid, rel));
  ipcMain.handle('project:create', (_e, name, goal) => {
    try { const p = store.create(name, goal); buildMenu(); openProject(p.id); return { ok: true, id: p.id }; }
    catch (e) { return { error: e.message }; }
  });
  // Opening a filed source (or a link in Gemini's reply): its own page, without logging it twice
  ipcMain.on('project:openLink', (_e, url) => {
    const a = active(); if (!a || !a.project) return;
    openSource(a, url);
  });
  ipcMain.handle('event:update', (_e, pid, eid, patch) => {
    const allowed = {};
    const p = store.get(pid);
    if (p && patch && p.collections.some(c => c.id === patch.type)) { allowed.type = patch.type; allowed.manualType = true; }
    if (patch && patch.status === 'kept') allowed.status = 'kept';
    store.updateEvent(pid, eid, allowed); broadcast(); return true;
  });
  // Editing the sidebar: files, source collections and phases
  ipcMain.handle('project:edit', async (_e, pid, op, a = {}) => {
    if (!store.get(pid)) return { error: 'Unknown project' };
    try {
      let out = {};
      switch (op) {
        case 'newFile': out.path = store.createFile(pid, a.path); break;
        case 'newFolder': out.path = store.createDir(pid, a.path); break;
        case 'rename': out.path = store.renamePath(pid, a.from, a.to); break;
        case 'delete': await shell.trashItem(store.deletable(pid, a.path)); break;   // recoverable from the Trash
        case 'newCollection': out.id = store.addCollection(pid, a.name); break;
        case 'renameCollection': store.renameCollection(pid, a.id, a.name); break;
        case 'deleteCollection': out.moved = store.deleteCollection(pid, a.id); break;
        case 'addLink': {
          const url = router.toUrl(String(a.url || ''));
          if (!/^https?:\/\//.test(url)) throw new Error('Enter a web address');
          if (store.hasUrl(pid, url)) throw new Error('That link is already in the project');
          store.addEvent(pid, { type: a.collection || router.classify(url), title: (a.title || '').trim() || url, url, tool: 'you',
                                why: (a.why || '').trim() || 'Added by hand' });
          break;
        }
        // phases and tasks go through team context when it is set up (the fold decides who may do what)
        case 'newPhase': out.phase = await opsFor(pid).addPhase(a.name); break;
        case 'renamePhase': out.phase = await opsFor(pid).renamePhase(a.phase, a.name); break;
        case 'movePhase': out.phase = await opsFor(pid).movePhase(a.phase, a.dir); break;
        case 'deletePhase': await opsFor(pid).deletePhase(a.phase); break;
        case 'currentPhase': store.setCurrentPhase(pid, a.phase); break;
        case 'toggleTask': await opsFor(pid).toggleTask(a.phase, Number(a.index)); behaviour.note(pid, 'task'); break;
        default: throw new Error('Unknown action');
      }
      broadcast();
      return { ok: true, ...out };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('event:delete', (_e, pid, eid) => { store.deleteEvent(pid, eid); broadcast(); return true; });
  ipcMain.on('tab:file', (_e, pid) => {
    const a = active();
    if (!a || !store.get(pid)) return;
    a.project = pid;
    const pg = pageOf(a);
    if (pg && pg.view && pg.url && !store.hasUrl(pid, pg.url)) {
      const ev = store.addEvent(pid, { type: router.classify(pg.url), title: pg.title || pg.url, url: pg.url, tool: 'browser',
                                       query: pg.query || null, why: 'Filed from the toolbar' });
      if (ev) pg.logged.push({ id: ev.id, url: pg.url });
      pg.lastKey = pg.url.split('#')[0];
    }
    layout(); broadcast();
  });
  ipcMain.on('tab:unfile', (_e, removeLogged) => {
    const a = active();
    if (!a || !a.project) return;
    for (const pg of a.pages) {
      if (removeLogged) for (const l of pg.logged) store.deleteEvent(a.project, l.id);
      pg.logged = [];
    }
    a.project = null; a.answer = null;
    // a plain tab shows one page: keep the active one
    for (const pg of a.pages.filter(p => p.id !== a.pageId)) destroyPage(pg);
    a.pages = a.pages.filter(p => p.id === a.pageId);
    if (a.pane === 'doc') a.pane = pageOf(a) ? 'web' : 'start';
    layout(); broadcast();
  });

  // projects: delete, reveal
  ipcMain.handle('project:delete', (_e, pid) => deleteProject(pid));
  ipcMain.on('project:reveal', (_e, pid) => { const r = store.root(pid); if (r) shell.openPath(r); });

  // source control
  ipcMain.handle('git:status', async (_e, pid) => { const r = store.root(pid); return r ? git.status(r) : { repo: false }; });
  ipcMain.handle('git:op', async (_e, pid, op, a) => {
    try { const out = await gitOp(pid, op, a); if (op !== 'show' && op !== 'suggestMessage') { broadcast(); send('git-changed', pid); } return { ok: true, ...out }; }
    catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('git:clone', (_e, url) => cloneRepo(url));

  // team context (its own branch and buttons; code push/pull are untouched)
  const teamView = async (pid, st) => {
    const tm = teamFor(pid);
    if (!tm) return { enabled: false };
    st = st || await opsFor(pid).sync();
    const now = Date.now();
    const blocked = Object.fromEntries(st.fold.phases.map(ph => [ph.id, takeoverBlocked(st.fold, ph.id, st.me.id, now)]));
    const { accepted, ...fold } = st.fold;
    return { enabled: true, me: st.me, fold: { ...fold, timeline: accepted.slice(-60).reverse().map(e => ({ at: e.at, by: e.by, text: describeEvent(e, st.fold) })) },
             issues: st.issues, styles: Object.fromEntries(Object.entries(st.styles).map(([k, v]) => [k, { styleMix: v.styleMix, rules: (v.hypotheses || []).length }])),
             phaseMap: (store.get(pid).team || {}).phaseMap || {}, blocked, settings: { lastPublished: st.settings.lastPublished || null, lastPulled: st.settings.lastPulled || null, shareStyle: !!st.settings.shareStyle },
             canUndoStyle: !!(behaviour.canUndoImport && behaviour.canUndoImport()) };
  };
  const teamCall = fn => async (_e, pid, ...args) => {
    try { if (!store.get(pid)) throw new Error('Unknown project'); const out = await fn(pid, ...args); broadcast(); return { ok: true, ...(out || {}) }; }
    catch (e) { return { error: e.message, rejected: e instanceof teamPlan.Rejected }; }
  };
  ipcMain.handle('team:state', teamCall(async pid => teamView(pid)));
  ipcMain.handle('team:setup', teamCall(async pid => {
    const tm = makeTeam(pid);
    const r = await tm.setup();
    if (r.created) await teamPlan.importLocalPlan(store, pid, tm);
    return teamView(pid);
  }));
  ipcMain.handle('team:pull', teamCall(async pid => {
    const tm = teamFor(pid); if (!tm) throw new Error('Set up team context first.');
    await tm.pull();
    return teamView(pid);
  }));
  ipcMain.handle('team:pending', teamCall(async pid => {
    const tm = teamFor(pid); if (!tm) throw new Error('Set up team context first.');
    return tm.pending();
  }));
  ipcMain.handle('team:publish', teamCall(async (pid, a = {}) => {
    const tm = teamFor(pid); if (!tm) throw new Error('Set up team context first.');
    const style = a.shareStyle && behaviour.exportStyle ? behaviour.exportStyle() : null;
    const r = await tm.publish({ drafts: a.drafts, shareStyle: !!a.shareStyle, style });
    return { nothing: !!r.nothing, ...(await teamView(pid)) };
  }));
  ipcMain.handle('team:action', teamCall(async (pid, op, a = {}) => {
    const ops = opsFor(pid); if (!ops.team) throw new Error('Set up team context first.');
    const fns = { start: () => ops.startPhase(a.phaseId), claim: () => ops.claim(a.phaseId, a.taskId), assign: () => ops.assign(a.phaseId, a.taskId, a.to),
                  handoff: () => ops.handoff(a.phaseId, a.to), takeover: () => ops.takeover(a.phaseId), takeback: () => ops.takeback(a.phaseId),
                  supersede: () => ops.supersedeDecision(a.decisionId, a.replacedBy, a.reason) };
    if (!fns[op]) throw new Error('Unknown action');
    const r = await fns[op]();
    return teamView(pid, r && r.state);
  }));
  ipcMain.handle('github:status', async () => {
    const tok = gitToken();
    if (!tok) return { hasToken: false };
    try {
      const res = await net.fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'User-Agent': 'Vyuha' } });
      if (res.status === 401) throw new Error('GitHub rejected the token. It may have expired or been copied incompletely.');
      const u = await res.json();
      const fine = tok.startsWith('github_pat_');
      const scopes = (res.headers.get('x-oauth-scopes') || '').split(',').map(x => x.trim()).filter(Boolean);
      let warning = '';
      if (!fine && !scopes.includes('repo')) warning = 'This classic token is missing the "repo" permission, so it can\u2019t create or push to repositories. Edit the token on GitHub and tick "repo".';
      if (fine) warning = 'This is a fine-grained token. To publish, it needs Repository access: All repositories, plus Administration and Contents: Read and write.';
      return { hasToken: true, login: u.login, fine, warning, fromEnv: !!process.env.GITHUB_TOKEN };
    }
    catch (e) { return { hasToken: true, error: e.message, fromEnv: !!process.env.GITHUB_TOKEN }; }
  });
  ipcMain.handle('github:setToken', (_e, token) => { saveSecret('github', String(token || '').trim()); return true; });

  // terminal
  ipcMain.handle('term:get', (_e, pid) => ({ output: terms.output(pid), running: terms.isRunning(pid), cwd: store.root(pid) }));
  ipcMain.handle('term:run', async (_e, pid, cmd) => {
    if (!store.get(pid) || !String(cmd || '').trim()) return { error: 'Nothing to run.' };
    if (terms.isRunning(pid)) return { error: 'A command is already running. Stop it first.' };
    const run = terms.run(pid, store.root(pid), String(cmd));
    run.catch(() => {});
    // team context only: after the command finishes, detect/resolve issues and show a teammate's fix
    const tm = teamFor(pid);
    if (tm) {
      run.then(r => teamHooks.terminalCommandHook(tm, { command: String(cmd), result: r, notify: ev => sendTeam(pid, ev.kind, ev), ...teamCommandContext(pid) }))
        .catch(e => console.error('team context (terminal):', e));
    }
    return { ok: true };
  });
  ipcMain.on('term:stop', (_e, pid) => terms.stop(pid));
  ipcMain.on('term:clear', (_e, pid) => terms.clear(pid));

  // Gemini
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, s) => {
    settings = { ...settings, ...s };
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
    broadcast();
    return settings;
  });
  ipcMain.handle('agent:status', () => agentStatus());
  ipcMain.handle('agent:ask', (_e, pid, text, view, extra) => askAgent(pid, String(text || '').trim(), view, extra || {}));
  // behaviour learning
  ipcMain.handle('behaviour:preview', (_e, pid, text, typing, override) => {
    if (!store.get(pid)) return null;
    const mode = store.readChat(pid).mode === 'build' ? 'build' : 'teach';
    return behaviour.preview(pid, String(text || ''), typing || {}, behaviourContext(pid, mode), override);
  });
  ipcMain.on('behaviour:note', (_e, pid, kind) => behaviour.note(pid, kind));
  ipcMain.handle('behaviour:summary', () => behaviour.summary());
  ipcMain.handle('behaviour:edit', (_e, op, a) => { try { return behaviour.edit(op, a); } catch (e) { return { error: e.message }; } });
  // "Answer like <name>": blend a teammate's shared answer style into mine (undoable)
  ipcMain.handle('team:importStyle', async (_e, pid, personId) => {
    try {
      const tm = teamFor(pid); if (!tm) throw new Error('Set up team context first.');
      const r = await teamHooks.importTeammateStyle(tm, behaviour, personId);
      send('behaviour', behaviour.summary());
      return { ok: true, ...r };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('team:undoStyle', () => { try { const s = behaviour.undoImport(); send('behaviour', s); return { ok: true }; } catch (e) { return { error: e.message }; } });
  ipcMain.handle('behaviour:analyse', () => runBehaviourAnalysis());
  ipcMain.on('behaviour:reveal', () => { fs.mkdirSync(behaviour.dir, { recursive: true }); shell.openPath(behaviour.dir); });
  ipcMain.handle('agent:chat', (_e, pid) => { const c = store.readChat(pid); return { transcript: c.transcript || [], running: running.has(pid), mode: c.mode === 'build' ? 'build' : 'teach' }; });
  ipcMain.handle('agent:setMode', (_e, pid, mode) => {
    const c = store.readChat(pid); c.mode = mode === 'build' ? 'build' : 'teach'; store.writeChat(pid, c); notifyAgent(pid); return c.mode;
  });
  ipcMain.handle('agent:clear', (_e, pid) => { if (!running.has(pid)) { const m = store.readChat(pid).mode; store.writeChat(pid, { transcript: [], history: [], mode: m }); } notifyAgent(pid); return true; });
  ipcMain.on('agent:approve', (_e, id, ok) => { const a = approvals.get(id); if (a) a.resolve(!!ok); });
  ipcMain.handle('agent:setKey', (_e, key) => { saveKey(String(key || '').trim()); return agentStatus(); });
  ipcMain.handle('agent:test', async () => {
    const apiKey = loadKey();
    if (!apiKey) return { ok: false, message: 'No API key saved yet.' };
    try { const r = await agent.test({ apiKey, model: settings.model }); return { ok: true, message: `Connected to ${settings.model}. It replied: ${r || '(empty)'}` }; }
    catch (e) { return { ok: false, message: agent.friendlyError(e, settings.model) }; }
  });

  ipcMain.on('slot', (_e, r) => { slot = r && r.width > 0 ? r : null; layout(); });
  ipcMain.on('overlay', (_e, on) => { overlayOpen = !!on; layout(); });
}

/* ---------- start ---------- */
app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'projects'), path.join(app.getPath('userData'), 'folders.json'));
  settings = loadSettings();
  behaviour = new Behaviour(path.join(app.getPath('userData'), 'behaviour'));
  terms = new Terminals((pid, ev) => send('term', { pid, ...ev }));
  wireIpc();

  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 820, minHeight: 520, show: false,
    title: 'Vyuha', backgroundColor: '#10171a',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'vyuha-app-icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  // open maximized (1360x860 is the size it returns to when un-maximized)
  win.maximize();
  win.show();
  const t = makeTab(); activeId = t.id;
  buildMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('resize', layout);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { const t = makeTab(); loadInTab(t, url, {}); activeId = t.id; layout(); broadcast(); }
    return { action: 'deny' };
  });
  win.webContents.on('did-finish-load', broadcast);
  console.log(`Vyuha projects folder: ${store.dir}`);
});

app.on('before-quit', () => { if (terms) terms.stopAll(); try { if (behaviour) behaviour.finishAll(); } catch (e) { /* ignore */ } });
app.on('window-all-closed', () => app.quit());
