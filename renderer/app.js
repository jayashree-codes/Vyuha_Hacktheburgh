// Vyuha UI.
// Plain tabs: the Vyuha home page, or a web page filling the window.
// Project tabs work like VS Code: files and sources on the left, editor tabs in
// the middle (web page, files, notes), a terminal underneath, Gemini on the right.
// Web pages are drawn by the main process over the #slot element.
const api = window.vyuha;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;                 // latest state from the main process
let P = null;                 // the project shown in the active tab (full data)
let AG = { hasKey: false, model: '' };
let shellKey = '', mainKey = '', renderSeq = 0;
let sideCollapsed = false, termOpen = false, gemOpen = false;
let openMenu = null;          // source whose ⋮ menu is open
let lastSlot = '';
const openFolders = {};       // project id -> Set of expanded folders
const itemsByTab = {};        // tab id -> open editor tabs (keys)
const revealed = {};          // project id -> file last revealed in the tree
const termHistory = []; let termHistIdx = -1;

const ICON = {
  mark: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 13c2.5-.5 3-3.5 5.5-4s4 1.5 5.5-1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 2.6"/><path d="M13 7V2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 2 9 3.5 13 5" fill="currentColor"/></svg>',
  markBig: s => `<svg width="${s}" height="${s}" viewBox="0 0 44 44" fill="none"><path d="M7 35c6-1 7-8 13-9s9 4 15-3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 5"/><circle cx="7" cy="35" r="3.2" fill="currentColor"/><circle cx="20" cy="26" r="3.2" fill="currentColor"/><path d="M35 23V7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M35.5 7.5 25 11l10.5 4" fill="currentColor"/></svg>`,
  go: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 4 12.5 8l-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg class="chev" width="10" height="10" viewBox="0 0 10 10"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.5h5.6c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1.75h5l3 3v9.5H4V1.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 1.75v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  db: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="3.75" rx="5" ry="1.9" stroke="currentColor" stroke-width="1.3"/><path d="M3 3.75v8.5c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9v-8.5M3 8c0 1.05 2.24 1.9 5 1.9S13 9.05 13 8" stroke="currentColor" stroke-width="1.3"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.75 6v4l3.5-2-3.5-2Z" fill="currentColor"/></svg>',
  flag: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 14V2.5M3.5 3h8l-2 2.75 2 2.75h-8" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.4"/><path d="m10.25 10.25 3.25 3.25" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M2 8h12M8 2c1.8 1.9 2.6 3.9 2.6 6S9.8 12.1 8 14C6.2 12.1 5.4 10.1 5.4 8S6.2 3.9 8 2Z" stroke="currentColor" stroke-width="1.3"/></svg>',
  info: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.25v4M8 4.75v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  dots: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.5" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="12.5" r="1.4"/></svg>',
  term: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="m4.5 6 2 2-2 2M8 10.5h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spark: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 1.5c.4 3.3 1.9 5.1 6.5 6.5-4.6 1.4-6.1 3.2-6.5 6.5-.4-3.3-1.9-5.1-6.5-6.5C6.1 6.6 7.6 4.8 8 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  collapse: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>'
};
const TYPE = {
  dataset: { folder: 'datasets', icon: ICON.db, cls: 'ic-ds' },
  video: { folder: 'videos', icon: ICON.play, cls: 'ic-vd' },
  repo: { folder: 'repositories', icon: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>', cls: 'ic-rs' },
  research: { folder: 'research', icon: ICON.link, cls: 'ic-rs' }
};
const EXT_CLS = { py: 'ic-ds', js: 'ic-ds', ts: 'ic-rs', html: 'ic-rs', css: 'ic-ph', json: 'ic-ac', md: 'ic-f', ipynb: 'ic-vd' };
const fileIcon = name => `<span class="${EXT_CLS[name.split('.').pop()] || 'ic-f'}">${ICON.file}</span>`;
const base = p => String(p).split('/').pop();

/* ---------- state ---------- */
api.onState(s => { S = s; render(); });
api.getState().then(s => { S = s; render(); });
api.agentStatus().then(st => { AG = st; mainKey = ''; render(); });
api.onAgent(pid => { if (P && P.id === pid) renderChat(pid); });
api.onTerm(onTermEvent);
api.onFileChanged(onFileChanged);
api.onGitChanged(pid => refreshGit(pid));
window.addEventListener('focus', () => { if (P && sideView[P.id] === 'git') refreshGit(P.id); });
api.onUi(msg => {
  if (msg === 'new-project') newProjectDialog();
  if (msg === 'settings') settingsDialog();
  if (msg === 'focus-address') { $('#address').focus(); $('#address').select(); }
  if (msg === 'focus-search') setTimeout(() => { const i = $('#homeInput') || $('#mainInput'); if (i) i.focus(); }, 30);
  if (msg === 'toggle-sidebar') { sideCollapsed = !sideCollapsed; render(); }
  if (msg === 'toggle-terminal') toggleTerm();
  if (msg === 'open-terminal') toggleTerm(true);
  if (msg === 'toggle-gemini') { const t = S && activeTab(); if (t && t.pane === 'start') focusChat(); else toggleGem(); }
  if (msg === 'open-gemini') toggleGem(true);
  if (msg === 'save') saveCurrent();
  if (msg === 'clone') cloneDialog();
});

const activeTab = () => S.tabs.find(t => t.id === S.activeId) || S.tabs[0];

function render() {
  if (!S) return;
  renderTabs();
  renderToolbar();
  const t = activeTab();
  if (t.project) renderProject(t);
  else renderPlain(t);
}

// Tell the main process where to draw the web page
function reportSlot() {
  const el = $('#slot');
  if (!el || el.hidden || !el.offsetParent) return;
  const r = el.getBoundingClientRect();
  const v = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  const k = JSON.stringify(v);
  if (k !== lastSlot) { lastSlot = k; api.setSlot(v); }
}
const slotObserver = new ResizeObserver(() => reportSlot());
function observeSlot() { const el = $('#slot'); if (el) slotObserver.observe(el); lastSlot = ''; requestAnimationFrame(reportSlot); }
window.addEventListener('resize', () => requestAnimationFrame(reportSlot));

/* ---------- browser tabs + toolbar ---------- */
function tabTitle(t) {
  if (t.pane === 'start') return t.project || 'New tab';
  if (t.pane === 'doc') return itemLabel(t, t.docPath);
  return t.title || t.url || 'Loading…';
}
function favicon(t) {
  if (t.project) return `<span class="fav proj">${ICON.folder}</span>`;
  if (t.pane === 'start') return `<span class="fav fhome">${ICON.mark}</span>`;
  let host = '';
  try { host = new URL(t.url).hostname.replace(/^www\./, ''); } catch (e) { /* loading */ }
  return `<span class="fav web${t.loading ? ' loading' : ''}">${esc((host[0] || '•').toUpperCase())}</span>`;
}
function renderTabs() {
  $('#tabs').innerHTML = S.tabs.map(t => `
    <div class="tab ${t.id === S.activeId ? 'on' : ''}" data-tab="${t.id}" role="tab" tabindex="0" aria-selected="${t.id === S.activeId}" title="${esc(t.project ? `${t.project} · ${tabTitle(t)}` : tabTitle(t))}">
      ${favicon(t)}<span class="tt">${esc(tabTitle(t))}</span>
      ${t.project && t.pane === 'web' && !/^(file:|https?:\/\/(localhost|127\.0\.0\.1))/.test(t.url || '') ? `<i class="filing" title="Filing to ${esc(t.project)}"></i>` : ''}
      <button class="tx" data-close="${t.id}" aria-label="Close tab">×</button>
    </div>`).join('');
}
function renderToolbar() {
  const t = activeTab(), a = $('#address');
  $('#back').disabled = !t.canBack;
  $('#fwd').disabled = !t.canForward;
  $('#reload').disabled = t.pane !== 'web';
  if (document.activeElement !== a) {
    a.value = t.pane === 'web' ? t.url
      : t.project ? `vyuha://projects/${t.project}${t.pane === 'doc' && t.docPath && t.docPath.startsWith('file:') ? '/' + t.docPath.slice(5) : ''}` : '';
  }
  if (document.activeElement && document.activeElement.id === 'fileTo') return; // don't close an open dropdown
  const c = $('#ctx');
  if (t.project) {
    const pill = t.pane === 'web' && !/^(file:|https?:\/\/(localhost|127\.0\.0\.1))/.test(t.url || '')
      ? `<span class="pill on" title="Every page in this tab is saved to the project"><i></i>Filing to <b>${esc(t.project)}</b></span>`
      : `<span class="pill on"><i></i><b>${esc(t.project)}</b></span>`;
    c.innerHTML = `${pill}
      <button class="tool ${termOpen ? 'on' : ''}" data-act="toggle-term" title="Terminal (Cmd+J)" aria-pressed="${termOpen}">${ICON.term}<span>Terminal</span></button>
      <button class="tool ${gemOpen || t.pane === 'start' ? 'on' : ''}" data-act="${t.pane === 'start' ? 'focus-chat' : 'toggle-gem'}" title="Gemini (Cmd+I)" aria-pressed="${gemOpen || t.pane === 'start'}">${ICON.spark}<span>Gemini</span>${S.running.includes(t.project) ? '<i class="busy"></i>' : ''}</button>`;
  } else if (t.pane === 'web') {
    c.innerHTML = `<span class="pill"><i></i>Not saved</span>
      <select class="mini" id="fileTo" aria-label="File this tab into a project"><option value="">File to…</option>
      ${S.projects.map(p => `<option value="${esc(p.id)}">${esc(p.id)}</option>`).join('')}</select>`;
  } else c.innerHTML = '';
}

/* ---------- plain tabs ---------- */
function renderPlain(t) {
  const key = `plain:${t.id}:${t.pane}`;
  if (key === shellKey) return;
  shellKey = key; P = null; disposeEditor();
  if (t.pane === 'start') {
    $('#content').innerHTML = `
      <div class="home">
        <div class="brand">${ICON.markBig(48)}<span class="wordmark">vyuha</span></div>
        <form id="homeForm" class="search" autocomplete="off">
          <input id="homeInput" placeholder="Search, go to a site, or ask about a project" aria-label="Search">
          <button class="go" aria-label="Go">${ICON.go}</button>
        </form>
      </div>`;
    $('#homeInput').focus();
  } else {
    $('#content').innerHTML = '<div id="slot" class="slot full"></div>';
    observeSlot();
  }
}

/* ---------- project tabs ---------- */
function projectShell() {
  return `<div class="pws" id="pws">
    <aside class="side" id="side"></aside>
    <div class="gutter gv" data-resize="side" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize sidebar (double-click to reset)" title="Drag to resize · double-click to reset"></div>
    <div class="gutter gv" data-resize="gem" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize Gemini panel (double-click to reset)" title="Drag to resize · double-click to reset"></div>
    <section class="pmain">
      <div class="etabs" id="etabs" role="tablist"></div>
      <div class="pbody">
        <div id="slot" class="slot" hidden></div>
        <div id="editorHost" class="host" hidden></div>
        <div id="docHost" class="host scroll" hidden></div>
        <div id="startHost" class="host" hidden>
          <div class="chatpage">
            <div class="chathead">${ICON.spark}<strong>Gemini</strong><span class="gm" id="mainModel"></span>
              <div class="modes" role="radiogroup" aria-label="How Gemini helps">
                <button type="button" role="radio" data-mode="teach" title="Gemini explains and teaches step by step">Teach me</button>
                <button type="button" role="radio" data-mode="build" title="Gemini writes files and runs commands for you">Build with me</button>
              </div>
              <span class="sp"></span><button class="mini" data-act="clear-chat">New chat</button></div>
            <div class="chatlog main" id="chatMain"></div>
            <form id="mainForm" class="mainbar" autocomplete="off">
              <textarea id="mainInput" rows="2" placeholder="Ask anything about this project, e.g. “I want to build a spam classifier, teach me how”"></textarea>
              <button class="go" aria-label="Send">${ICON.go}</button>
            </form>
          </div>
        </div>
      </div>
      <div class="term" id="term">
        <div class="gutter gh" data-resize="term" tabindex="0" role="separator" aria-orientation="horizontal" aria-label="Resize terminal (double-click to reset)" title="Drag to resize · double-click to reset"></div>
        <div class="termh"><strong>Terminal</strong><code id="termCwd"></code><span class="sp"></span>
          <button class="mini" data-act="term-stop" id="termStop" hidden>Stop</button>
          <button class="mini" data-act="term-clear">Clear</button>
          <button class="sidebtn" data-act="toggle-term" aria-label="Close terminal">×</button></div>
        <pre class="termout" id="termOut"></pre>
        <form id="termForm" class="termin" autocomplete="off"><span>$</span><input id="termInput" spellcheck="false" placeholder="Run a command in this project, e.g. python train.py"></form>
      </div>
    </section>
    <aside class="gem" id="gem">
      <div class="gemh">${ICON.spark}<strong>Gemini</strong><span class="gm" id="gemModel"></span><span class="sp"></span>
        <button class="mini" data-act="clear-chat">Clear</button>
        <button class="sidebtn" data-act="toggle-gem" aria-label="Close Gemini">×</button></div>
      <div class="chatlog" id="chatlog"></div>
      <div class="gemfoot">
        <div class="gemctx" id="gemCtx"></div>
        <form id="gemForm" class="gembar" autocomplete="off">
          <textarea id="gemInput" rows="3" placeholder="Ask Gemini to research, explain or build…"></textarea>
          <button class="go" aria-label="Send">${ICON.go}</button>
        </form>
      </div>
    </aside>
  </div>`;
}

/* ---------- resizable panels ---------- */
const SIZES = {
  side: { v: '--side-w', def: 264, min: 180, max: () => Math.min(600, innerWidth - 420) },
  gem:  { v: '--gem-w',  def: 380, min: 280, max: () => Math.min(800, innerWidth - 420) },
  term: { v: '--term-h', def: 240, min: 100, max: () => Math.max(140, innerHeight - 250) }
};
let sizes = {};
try { sizes = JSON.parse(localStorage.getItem('vyuha.sizes') || '{}') || {}; } catch { sizes = {}; }
function clampSize(k, px) { const d = SIZES[k]; return Math.round(Math.max(d.min, Math.min(d.max(), px))); }
function applySizes() {
  for (const k in SIZES) {
    if (sizes[k]) document.documentElement.style.setProperty(SIZES[k].v, clampSize(k, sizes[k]) + 'px');
    else document.documentElement.style.removeProperty(SIZES[k].v);
  }
}
function saveSizes() { try { localStorage.setItem('vyuha.sizes', JSON.stringify(sizes)); } catch {} }
function currentSize(k) {
  if (k === 'side') return $('#side')?.getBoundingClientRect().width || SIZES.side.def;
  if (k === 'gem') return $('#gem')?.getBoundingClientRect().width || SIZES.gem.def;
  return $('#term')?.getBoundingClientRect().height || SIZES.term.def;
}
function setSize(k, px) { sizes[k] = clampSize(k, px); applySizes(); }
applySizes();
window.addEventListener('resize', () => applySizes());

document.addEventListener('pointerdown', e => {
  const g = e.target.closest?.('[data-resize]'); if (!g || e.button !== 0) return;
  e.preventDefault();
  const k = g.dataset.resize, start = currentSize(k), x0 = e.clientX, y0 = e.clientY;
  // web pages are native views drawn above the UI and would swallow the mouse, so hide them while dragging
  api.overlay(true);
  document.body.classList.add('resizing', k === 'term' ? 'row' : 'col');
  g.classList.add('drag');
  let raf = 0, last = e;
  const move = ev => {
    if (ev.type === 'pointermove' && ev.buttons === 0 && ev.pointerType === 'mouse' && ev.isTrusted) return up();
    last = ev; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const dx = last.clientX - x0, dy = last.clientY - y0;
      setSize(k, k === 'side' ? start + dx : k === 'gem' ? start - dx : start - dy);
    });
  };
  let done = false;
  const up = () => {
    if (done) return; done = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    window.removeEventListener('blur', up);
    if (raf) cancelAnimationFrame(raf);
    g.classList.remove('drag');
    document.body.classList.remove('resizing', 'row', 'col');
    saveSizes();
    api.overlay(false);
    requestAnimationFrame(reportSlot);
    if (k === 'term') scrollTerm(true);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('blur', up);
});
document.addEventListener('dblclick', e => {
  const g = e.target.closest?.('[data-resize]'); if (!g) return;
  delete sizes[g.dataset.resize]; applySizes(); saveSizes(); requestAnimationFrame(reportSlot);
});
document.addEventListener('keydown', e => {
  const g = e.target.closest?.('[data-resize]'); if (!g) return;
  const k = g.dataset.resize, step = e.shiftKey ? 50 : 10;
  const grow = { side: ['ArrowRight', 'ArrowLeft'], gem: ['ArrowLeft', 'ArrowRight'], term: ['ArrowUp', 'ArrowDown'] }[k];
  let d = 0;
  if (e.key === grow[0]) d = step; else if (e.key === grow[1]) d = -step;
  else if (e.key === 'Home' || e.key === 'Enter') { delete sizes[k]; applySizes(); saveSizes(); requestAnimationFrame(reportSlot); e.preventDefault(); return; }
  if (!d) return;
  e.preventDefault(); setSize(k, currentSize(k) + d); saveSizes(); requestAnimationFrame(reportSlot);
});

function applyLayout() {
  const w = $('#pws'); if (!w) return;
  w.classList.toggle('collapsed', sideCollapsed);
  // the Gemini side panel is for when a page or file is open; the project home is Gemini itself
  w.classList.toggle('gem-open', gemOpen && !!S && activeTab().pane !== 'start');
  w.classList.toggle('term-open', termOpen);
  requestAnimationFrame(reportSlot);
}
function toggleTerm(force) {
  termOpen = force === undefined ? !termOpen : force;
  applyLayout(); renderToolbar();
  if (termOpen) { const i = $('#termInput'); if (i && force === undefined) i.focus(); scrollTerm(true); }
}
function toggleGem(force) {
  gemOpen = force === undefined ? !gemOpen : force;
  applyLayout(); renderToolbar();
  if (gemOpen && P) { renderChat(P.id); const i = $('#gemInput'); if (i && force === undefined) i.focus(); }
}

async function renderProject(t) {
  const mySeq = ++renderSeq;
  const p = await api.getProject(t.project);
  if (!p || mySeq !== renderSeq) return;
  P = p;
  const key = `proj:${t.id}:${p.id}`;
  if (key !== shellKey) {
    disposeEditor();
    shellKey = key; mainKey = '';
    $('#content').innerHTML = projectShell();
    observeSlot();
    loadTerm(p);
    renderChat(p.id);
  }
  applyLayout();

  const tree = $('#sideTree');
  const scroll = tree ? tree.scrollTop : 0;
  // keep an inline name being typed across re-renders
  const cm = $('#commitMsg');
  const cmSel = cm && document.activeElement === cm ? [cm.selectionStart, cm.selectionEnd] : null;
  const re = $('#rowEdit');
  const typed = re ? re.value : null, sel = re ? [re.selectionStart, re.selectionEnd] : null;
  $('#side').innerHTML = sidebarHTML(t, p);
  const nt = $('#sideTree'); if (nt) nt.scrollTop = scroll;
  const ncm = $('#commitMsg');
  if (ncm && cmSel) { ncm.focus(); ncm.setSelectionRange(cmSel[0], cmSel[1]); }
  const ne = $('#rowEdit');
  if (ne && edit) {
    ne.value = typed ?? edit.value ?? '';
    ne.focus();
    if (sel) ne.setSelectionRange(sel[0], sel[1]);
    else { const dot = ne.value.lastIndexOf('.'); ne.setSelectionRange(0, edit.kind === 'rename' && dot > 0 ? dot : ne.value.length); }
    ne.scrollIntoView({ block: 'nearest' });
  }

  syncItems(t);
  renderEtabs(t);
  updateGemCtx(t);

  const isDiff = t.pane === 'doc' && (t.docPath || '').startsWith('diff:');
  const isFile = t.pane === 'doc' && ((t.docPath || '').startsWith('file:') || isDiff);
  $('#slot').hidden = t.pane !== 'web';
  $('#editorHost').hidden = !isFile;
  $('#docHost').hidden = !(t.pane === 'doc' && !isFile);
  $('#startHost').hidden = t.pane !== 'start';

  const mk = `${t.id}:${t.pane}:${t.docPath || ''}:${t.answer ? t.answer.at : ''}:${AG.hasKey}`;
  if (mk !== mainKey || (t.pane === 'doc' && !isFile)) {
    mainKey = mk;
    if (t.pane === 'start') {
      renderChat(p.id);
      const i = $('#mainInput'); if (i && document.activeElement === document.body) i.focus();
    } else if (isDiff) await openDiff(p.id, t.docPath.slice(5));
    else if (isFile) await openInEditor(p.id, t.docPath.slice(5));
    else if (t.pane === 'doc') renderDoc(t, p);
  }
  requestAnimationFrame(reportSlot);
}

/* ---------- editor tabs (page, files, notes) ---------- */
function activeKey(t) { return t.pane === 'web' ? 'page:' + t.pageId : t.pane === 'start' ? 'start' : t.docPath; }
// Editor tabs: Gemini first, then pages and files in the order they were opened
function syncItems(t) {
  const pageKeys = new Set((t.pages || []).map(p => 'page:' + p.id));
  let items = (itemsByTab[t.id] || ['start']).filter(k => !k.startsWith('page:') || pageKeys.has(k));
  if (!items.includes('start')) items.unshift('start');
  for (const k of pageKeys) if (!items.includes(k)) items.push(k);
  const k = activeKey(t);
  if (k && !items.includes(k) && !k.startsWith('page:')) items.push(k);
  itemsByTab[t.id] = items;
}
const pageById = (t, k) => (t.pages || []).find(p => 'page:' + p.id === k);
function pageLabel(pg) {
  if (!pg) return 'Page';
  if ((pg.url || '').startsWith('file:')) return 'Preview: ' + (pg.title && !pg.title.startsWith('file:') ? pg.title : base(decodeURIComponent(pg.url)));
  return pg.title || pg.url || 'Loading…';
}
function itemLabel(t, k) {
  if (!k) return '';
  if (k === 'start') return 'Gemini';
  if (k.startsWith('page:')) return pageLabel(pageById(t, k));
  if (k.startsWith('file:')) return base(k.slice(5));
  if (k.startsWith('diff:')) return base(k.slice(5)) + ' (changes)';
  if (k.startsWith('event:')) { const e = P && P.events.find(x => x.id === k.slice(6)); return 'Info: ' + (e ? shortTitle(e) : 'source'); }
  if (k.startsWith('phase:')) return k.slice(6) + '.md';
  if (k === 'decisions') return 'decisions.md';
  return k;
}
function itemIcon(k) {
  if (k === 'start') return `<span class="ic-ac">${ICON.spark}</span>`;
  if (k.startsWith('page:')) return `<span class="ic-rs">${ICON.globe}</span>`;
  if (k.startsWith('file:')) return fileIcon(k);
  if (k.startsWith('diff:')) return `<span class="ic-ds">${SCM_ICON}</span>`;
  if (k.startsWith('event:')) return `<span class="ic-f">${ICON.info}</span>`;
  return `<span class="ic-ph">${ICON.flag}</span>`;
}
function renderEtabs(t) {
  const el = $('#etabs'); if (!el) return;
  const cur = activeKey(t);
  el.innerHTML = (itemsByTab[t.id] || []).map(k => {
    const dirty = k.startsWith('file:') && P && isDirtyPath(P.id, k.slice(5));
    const closable = k !== 'start';
    return `<div class="etab ${k === cur ? 'on' : ''}" data-item="${esc(k)}" role="tab" tabindex="0" title="${esc(k.startsWith('file:') ? k.slice(5) : itemLabel(t, k))}">
      ${itemIcon(k)}<span class="et">${esc(itemLabel(t, k))}</span>${dirty ? '<i class="dirty" title="Unsaved changes"></i>' : ''}
      ${closable ? `<button class="ex" data-close-item="${esc(k)}" aria-label="Close">×</button>` : ''}</div>`;
  }).join('') + (previewable(cur)
    ? `<span class="sp"></span><button class="tool preview" data-act="preview" title="Open this page in the tab and reload it on every save">${ICON.play}<span>Preview</span></button>`
    : '');
}
const previewable = k => !!k && k.startsWith('file:') && /\.(html?|svg)$/i.test(k);
async function previewCurrent() {
  const t = activeTab();
  if (!t || !t.project || !previewable(activeKey(t))) return;
  const rel = t.docPath.slice(5);
  const ent = models.get(t.project + '\u0000' + rel);
  if (ent && isDirty(ent)) await saveCurrent();   // preview what's in the editor
  const r = await api.previewFile(t.project, rel);
  if (r && r.error) toast(r.error);
}
function goItem(k) {
  if (k === 'start') api.setPane('start');
  else if (k.startsWith('page:')) api.setPane('web', k.slice(5));
  else api.setPane('doc', k);
}
function closeItem(k) {
  const t = activeTab();
  const items = itemsByTab[t.id] || [];
  if (k.startsWith('file:') && P) {
    const mk = P.id + '\u0000' + k.slice(5);
    const ent = models.get(mk);
    if (ent && isDirty(ent) && !window.confirm(`Discard unsaved changes to ${k.slice(5)}?`)) return;
    if (ent) { ent.model.dispose(); models.delete(mk); }
  }
  const i = items.indexOf(k);
  if (i >= 0) items.splice(i, 1);
  const neighbour = items[i] || items[i - 1] || 'start';   // like VS Code: the tab that takes its place
  if (k.startsWith('page:')) {   // the page itself is closed in the main process
    api.closePage(k.slice(5));
    if (activeKey(t) === k) goItem(neighbour);
    return;
  }
  if (activeKey(t) === k) goItem(neighbour);
  else renderEtabs(t);
}

/* ---------- Monaco editor ---------- */
let monacoP = null, editor = null;
const models = new Map();   // "pid\0path" -> { model, saved, pid, path }
const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (window.monaco) window.monaco.editor.setTheme(dark() ? 'vs-dark' : 'vs'); });

function loadMonaco() {
  if (monacoP) return monacoP;
  monacoP = new Promise((resolve, reject) => {
    if (!window.require || !window.require.config) return reject(new Error('missing'));
    window.require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
    window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  monacoP.catch(() => { monacoP = null; });
  return monacoP;
}
const isDirty = ent => ent.model.getAlternativeVersionId() !== ent.saved;
const isDirtyPath = (pid, rel) => { const e = models.get(pid + '\u0000' + rel); return !!e && isDirty(e); };
let diffEditor = null, diffModels = [];
function disposeDiff() { if (diffEditor) { diffEditor.dispose(); diffEditor = null; } diffModels.forEach(m => m.dispose()); diffModels = []; }
function disposeEditor() { if (editor) { editor.dispose(); editor = null; } disposeDiff(); }

// Side-by-side diff of a file: last commit on the left, the file now on the right
async function openDiff(pid, rel) {
  const host = $('#editorHost');
  let monaco;
  try { monaco = await loadMonaco(); } catch (e) { host.innerHTML = '<p class="empty pad">Install the editor (npm install monaco-editor) to see diffs.</p>'; return; }
  const [old, now] = await Promise.all([api.gitOp(pid, 'show', { path: rel }), api.readFile(pid, rel)]);
  if (editor) { editor.dispose(); editor = null; }
  disposeDiff();
  host.innerHTML = '';
  const lang = undefined;
  const a = monaco.editor.createModel(old.content || '', lang, monaco.Uri.file(`/__head__/${pid}/${rel}`));
  const b = monaco.editor.createModel(now.content != null ? now.content : '', lang, monaco.Uri.file(`/__now__/${pid}/${rel}`));
  diffModels = [a, b];
  diffEditor = monaco.editor.createDiffEditor(host, { automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: true,
    theme: dark() ? 'vs-dark' : 'vs', fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false });
  diffEditor.setModel({ original: a, modified: b });
}

async function openInEditor(pid, rel) {
  const host = $('#editorHost');
  let monaco;
  try { monaco = await loadMonaco(); }
  catch (e) {
    const r = await api.readFile(pid, rel);
    host.innerHTML = `<div class="notice">The code editor isn't installed. Run <code>npm install monaco-editor</code> in the vyuha folder and restart. Showing ${esc(rel)} read-only.</div>` +
      (r.error ? `<p class="empty pad">${esc(r.error)}</p>` : `<pre class="code">${esc(r.content)}</pre>`);
    return;
  }
  const key = pid + '\u0000' + rel;
  let ent = models.get(key);
  if (!ent) {
    const r = await api.readFile(pid, rel);
    if (r.error) { disposeEditor(); host.innerHTML = `<p class="empty pad">${esc(r.error)}</p>`; return; }
    const model = monaco.editor.createModel(r.content, undefined, monaco.Uri.file(`/${pid}/${rel}`));
    ent = { model, pid, path: rel, saved: model.getAlternativeVersionId() };
    models.set(key, ent);
    model.onDidChangeContent(() => { const t = S && activeTab(); if (t) { renderEtabs(t); updateGemCtx(t); } });
  }
  if (diffEditor) disposeDiff();
  if (!editor || !host.contains(editor.getDomNode())) {
    disposeEditor();
    host.innerHTML = '';
    editor = monaco.editor.create(host, {
      automaticLayout: true, theme: dark() ? 'vs-dark' : 'vs', fontSize: 13, minimap: { enabled: false },
      scrollBeyondLastLine: false, renderWhitespace: 'selection', tabSize: 4
    });
  }
  if (editor.getModel() !== ent.model) editor.setModel(ent.model);
  editor.focus();
}

async function saveCurrent() {
  const t = S && activeTab();
  if (!t || !t.project || t.pane !== 'doc' || !(t.docPath || '').startsWith('file:')) return;
  const rel = t.docPath.slice(5);
  const ent = models.get(t.project + '\u0000' + rel);
  if (!ent) return;
  const r = await api.writeFile(t.project, rel, ent.model.getValue());
  if (r.error) return toast(r.error);
  ent.saved = ent.model.getAlternativeVersionId();
  renderEtabs(t);
  toast(`Saved ${rel}`);
}

// Gemini (or anything else) changed a file: update the open editor, keeping undo
async function onFileChanged({ pid, path }) {
  const ent = models.get(pid + '\u0000' + path);
  if (!ent) return;
  if (isDirty(ent)) { toast(`Gemini changed ${path}. You have unsaved edits; saving will keep yours.`); return; }
  const r = await api.readFile(pid, path);
  if (r.content == null) return;
  ent.model.pushEditOperations([], [{ range: ent.model.getFullModelRange(), text: r.content }], () => null);
  ent.saved = ent.model.getAlternativeVersionId();
  const t = activeTab(); if (t) renderEtabs(t);
}

/* ---------- sidebar ---------- */
function shortTitle(e) {
  if (e.title && e.title !== e.url) return e.title;
  try { const u = new URL(e.url); return u.hostname.replace(/^www\./, '') + u.pathname; } catch (err) { return e.url; }
}
// Sources: the built-in collections keep their icons; your own collections get a folder icon
const colInfo = (id) => TYPE[id] || { icon: ICON.link, cls: 'ic-f' };
const colName = (p, id) => ((p.collections || []).find(c => c.id === id) || { name: id }).name;
const BUILT_IN_COLS = ['dataset', 'video', 'repo', 'research'];
// "3/5" for a phase whose notes have a checklist
function progress(notes) {
  const all = (String(notes || '').match(/^\s*[-*]\s+\[( |x|X)\]/gm) || []);
  if (!all.length) return null;
  return { done: all.filter(t => /\[(x|X)\]/.test(t)).length, total: all.length };
}
const SECTION_ICON = {
  file: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 1.75h5l3 3v9.5H4V1.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 7.5v4M6 9.5h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  folder: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.5h5.6c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 7.5v3.5M6.25 9.25h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12.5 11v4M10.5 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
};
let edit = null;   // inline name editing: { kind, parent?, target?, value }

// What each ⋮ menu offers
function menuItems(p, key) {
  const [k, ...rest] = key.split(':'); const v = rest.join(':');
  const item = (label, attrs, cls = '') => `<button role="menuitem" class="${cls}" ${attrs}>${label}</button>`;
  if (k === 'f') return item('Rename', `data-edit="rename" data-target="${esc(v)}"`) + item('Delete', `data-op="delete" data-path="${esc(v)}"`, 'danger');
  if (k === 'd') return item('New file here', `data-edit="newFile" data-parent="${esc(v)}"`) + item('New folder here', `data-edit="newFolder" data-parent="${esc(v)}"`)
    + item('Rename', `data-edit="rename" data-target="${esc(v)}"`) + item('Delete folder', `data-op="delete" data-path="${esc(v)}" data-dir="1"`, 'danger');
  if (k === 'c') return item('Add a link here', `data-act="add-link" data-col="${esc(v)}"`) + item('Rename', `data-edit="renameCollection" data-target="${esc(v)}"`)
    + (BUILT_IN_COLS.includes(v) ? '' : item('Delete collection', `data-op="deleteCollection" data-id="${esc(v)}"`, 'danger'));
  if (k === 's') {
    const e = p.events.find(x => x.id === v); if (!e) return '';
    return item('More info', `data-doc="event:${esc(v)}"`)
      + (e.status === 'suggested' ? item('Mark as chosen', `data-keep="${esc(v)}"`) : '')
      + p.collections.filter(c => c.id !== e.type).map(c => item(`Move to ${esc(c.name)}`, `data-move="${esc(v)}" data-to="${esc(c.id)}"`)).join('')
      + item('Remove from project', `data-del="${esc(v)}"`, 'danger');
  }
  if (k === 'proj') return item('Reveal in Finder', `data-act="reveal-project"`) + item('Clone a repository…', `data-act="clone"`) + item('Delete project…', `data-act="delete-project"`, 'danger');
  if (k === 'p') {
    const i = p.phases.indexOf(v);
    return (v !== p.phase ? item('Set as current phase', `data-op="currentPhase" data-phase="${esc(v)}"`) : '')
      + item('Rename', `data-edit="renamePhase" data-target="${esc(v)}"`)
      + (i > 0 ? item('Move up', `data-op="movePhase" data-phase="${esc(v)}" data-dir="-1"`) : '')
      + (i < p.phases.length - 1 ? item('Move down', `data-op="movePhase" data-phase="${esc(v)}" data-dir="1"`) : '')
      + (p.phases.length > 1 ? item('Delete phase', `data-op="deletePhase" data-phase="${esc(v)}"`, 'danger') : '');
  }
  return '';
}
const moreBtn = key => `<button class="more" data-menu="${esc(key)}" title="More actions" aria-label="More actions" aria-haspopup="menu" aria-expanded="${openMenu === key}">${ICON.dots}</button>`;
const menuHTML = (p, key) => (openMenu === key ? `<div class="rowmenu" role="menu">${menuItems(p, key)}</div>` : '');
const editRow = (pad, icon) => `<div class="row editing" ${pad}>${icon}<input id="rowEdit" class="rowedit" spellcheck="false" autocomplete="off" aria-label="Name"></div>`;

/* ---------- Source Control (git + GitHub) ---------- */
const SCM_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4.5" cy="3.5" r="1.75" stroke="currentColor" stroke-width="1.3"/><circle cx="4.5" cy="12.5" r="1.75" stroke="currentColor" stroke-width="1.3"/><circle cx="11.5" cy="6" r="1.75" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 5.25v5.5M11.5 7.75c0 2.5-2.5 2.75-5.4 3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const FILES_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M5 1.75h4.5l3 3v8.5H5V1.75Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 4.5v9.75h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const sideView = {};        // project id -> 'files' | 'git'
const gitState = {};        // project id -> last git status
const gitBusy = {};         // project id -> running action
const commitDraft = {};     // project id -> commit message being typed
let ghStatus = null;
const gitInflight = new Set();
async function refreshGit(pid) {
  if (gitInflight.has(pid)) return;
  gitInflight.add(pid);
  try { gitState[pid] = { ...(await api.gitStatus(pid)), at: Date.now() }; }
  finally { gitInflight.delete(pid); }
  if (P && P.id === pid) render();
}
async function gitAction(pid, op, args = {}) {
  gitBusy[pid] = op; render();
  const r = await api.gitOp(pid, op, args);
  gitBusy[pid] = null;
  if (r.error) toast(r.error);
  else {
    if (op === 'commit') { commitDraft[pid] = ''; toast('Committed'); }
    if (op === 'push') toast('Pushed to GitHub');
    if (op === 'pull') toast(r.message || 'Pulled');
    if (op === 'init') toast('Repository created');
    if (op === 'publish') toast('Published to GitHub');
  }
  await refreshGit(pid);
  return r;
}
const CODE_CLS = { M: 'gm-m', U: 'gm-a', A: 'gm-a', D: 'gm-d', R: 'gm-r', C: 'gm-r' };
const CODE_TIP = { M: 'Modified', U: 'New file', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied' };

function scmHTML(p) {
  const g = gitState[p.id];
  const busy = gitBusy[p.id];
  if (!g) { setTimeout(() => refreshGit(p.id), 0); return '<div class="scm"><p class="empty">Checking the repository…</p></div>'; }
  if (g.gitMissing) return `<div class="scm"><p>Git isn't installed on this Mac.</p><p class="empty">Open the Terminal app and run <code>xcode-select --install</code>, then come back.</p></div>`;
  if (!g.repo) return `<div class="scm">
      <p>This project isn't under version control yet.</p>
      <button class="btn primary wide" data-git="init" ${busy ? 'disabled' : ''}>Initialize repository</button>
      <button class="btn wide" data-act="publish" ${busy ? 'disabled' : ''}>${SCM_ICON} Publish to GitHub</button>
      <p class="empty sm">Publishing creates a GitHub repository, makes a first commit and pushes it.</p>
    </div>`;
  const n = g.files.length;
  const sync = g.upstream ? `${g.behind ? `↓${g.behind} ` : ''}${g.ahead ? `↑${g.ahead}` : ''}` || 'up to date' : (g.remote ? 'not pushed yet' : '');
  const draft = commitDraft[p.id] || '';
  return `<div class="scm">
    <div class="scmrow"><span class="branch" title="Current branch">${SCM_ICON}<b>${esc(g.branch || 'no branch')}</b></span><span class="sync">${esc(sync)}</span>
      <span class="sp"></span><button class="sidebtn sm" data-git="refresh" title="Refresh" aria-label="Refresh">↻</button></div>
    ${!g.rootIsProject ? `<p class="empty sm">This folder is part of a larger repository at ${esc(g.root)}.</p>` : ''}
    <div class="scmrow remote">${g.github
      ? `<button class="linkbtn" data-url="${esc(g.github.url)}" title="Open on GitHub">${esc(g.github.owner)}/${esc(g.github.repo)}</button>`
      : g.remote ? `<span class="empty sm" title="${esc(g.remote)}">${esc(g.remote)}</span>` : `<button class="btn sm" data-act="publish" ${busy ? 'disabled' : ''}>Publish to GitHub</button>`}
      ${g.remote ? `<span class="sp"></span><button class="btn sm" data-git="pull" ${busy ? 'disabled' : ''}>${busy === 'pull' ? 'Pulling…' : 'Pull'}</button><button class="btn sm ${g.ahead || !g.upstream ? 'primary' : ''}" data-git="push" ${busy || g.noCommits ? 'disabled' : ''}>${busy === 'push' ? 'Pushing…' : 'Push'}</button>` : ''}
    </div>
    <div class="commitbox">
      <textarea id="commitMsg" rows="2" placeholder="Commit message" aria-label="Commit message">${esc(draft)}</textarea>
      <div class="scmrow">${AG.hasKey ? `<button class="btn sm" data-git="suggest" ${busy || !n ? 'disabled' : ''} title="Gemini writes a message from your changes">${busy === 'suggestMessage' ? 'Writing…' : '✦ Write message'}</button>` : ''}
        <span class="sp"></span><button class="btn sm primary" data-git="commit" ${busy || !n ? 'disabled' : ''}>${busy === 'commit' ? 'Committing…' : `Commit${n ? ` ${n} change${n === 1 ? '' : 's'}` : ''}`}</button></div>
    </div>
    ${g.files.some(f => /(^|\/)(__pycache__\/|\.venv\/|venv\/)|\.pyc$/.test(f.path)) ? `<div class="hint">Python cache files are showing up as changes. <button class="linkbtn" data-git="gitignore">Add a .gitignore</button> to leave them out.</div>` : ''}
    <div class="scmh">Changes <span class="cnt">${n}</span></div>
    ${n ? g.files.map(f => `<button class="row scmfile" data-diff="${esc(f.path)}" title="${esc(CODE_TIP[f.code] || f.code)}: ${esc(f.path)}">
        ${fileIcon(base(f.path))}<span class="nm">${esc(base(f.path))}</span><span class="dir">${esc(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '')}</span>
        <span class="gcode ${CODE_CLS[f.code] || ''}">${esc(f.code)}</span></button>`).join('')
      : '<p class="empty sm">No changes since the last commit.</p>'}
    <div class="scmh">Recent commits</div>
    ${g.commits.length ? g.commits.map(c => `<div class="commit" title="${esc(c.hash)} by ${esc(c.author)}"><span class="nm">${esc(c.subject)}</span><span class="when">${esc(c.when)}</span></div>`).join('') : '<p class="empty sm">No commits yet.</p>'}
  </div>`;
}

function sidebarHTML(t, p) {
  if (sideCollapsed) {
    return `<button class="sidebtn" data-act="toggle-side" title="Show folders (Cmd+B)" aria-label="Show folders">${ICON.collapse}</button>
      <button class="sidebtn ic-ac" data-act="proj-start" title="Gemini" aria-label="Gemini">${ICON.spark}</button>`;
  }
  if (sideView[p.id] === 'git') {
    // keep the change list fresh while it's showing (files saved, Gemini edits, terminal commands)
    if (gitState[p.id] && Date.now() - (gitState[p.id].at || 0) > 3000) setTimeout(() => refreshGit(p.id), 0);
    return sideFrame(p, `<div class="tree" id="sideTree">${scmHTML(p)}</div>`);
  }
  const open = openFolders[p.id] || (openFolders[p.id] = new Set(['sec:files', 'sec:sources', 'sec:plan', 'col:dataset', 'col:video', 'col:repo', 'col:research']));
  const cur = t.pane === 'web' ? (t.url || '').split('#')[0] : null;
  const docSel = t.pane === 'doc' ? t.docPath : null;
  // reveal the open file in the tree, like VS Code
  if (docSel && docSel.startsWith('file:') && docSel !== revealed[p.id]) {
    revealed[p.id] = docSel;
    open.add('sec:files');
    const parts = docSel.slice(5).split('/');
    for (let i = 1; i < parts.length; i++) open.add('dir:' + parts.slice(0, i).join('/'));
  }
  const padOf = depth => `style="padding-left:${10 + depth * 12}px"`;
  const section = (key, label, count, buttons) => `<div class="sect ${open.has(key) ? 'open' : ''}">
      <button class="secth" data-folder="${key}" aria-expanded="${open.has(key)}">${ICON.chev}<span>${label}</span>${count != null ? `<span class="cnt">${count}</span>` : ''}</button>
      <span class="sectb">${buttons}</span></div>`;
  const sbtn = (title, attrs, icon) => `<button class="sidebtn sm" title="${title}" aria-label="${title}" ${attrs}>${icon}</button>`;

  // files
  const fileRows = (nodes, depth, parent) => {
    let h = '';
    if (edit && (edit.kind === 'newFile' || edit.kind === 'newFolder') && edit.parent === parent)
      h += editRow(padOf(depth), `<span class="chev sp10"></span><span class="ic-f">${edit.kind === 'newFolder' ? ICON.folder : ICON.file}</span>`);
    for (const n of nodes) {
      const isRen = edit && edit.kind === 'rename' && edit.target === n.path;
      if (n.dir) {
        const k = 'dir:' + n.path, mk = 'd:' + n.path;
        h += isRen ? editRow(padOf(depth), `${ICON.chev}<span class="ic-f">${ICON.folder}</span>`)
          : `<div class="row tree-row ${openMenu === mk ? 'menuopen' : ''}" data-ctx="${esc(mk)}"><button class="lk folder ${open.has(k) ? 'open' : ''}" data-folder="${esc(k)}" ${padOf(depth)}>${ICON.chev}<span class="ic-f">${ICON.folder}</span><span class="nm">${esc(n.name)}</span></button>${moreBtn(mk)}${menuHTML(p, mk)}</div>`;
        if (open.has(k) || (edit && edit.parent === n.path)) h += fileRows(n.children, depth + 1, n.path);
      } else {
        const id = 'file:' + n.path, mk = 'f:' + n.path;
        h += isRen ? editRow(padOf(depth), `<span class="chev sp10"></span>${fileIcon(n.name)}`)
          : `<div class="row tree-row ${docSel === id ? 'active' : ''} ${openMenu === mk ? 'menuopen' : ''}" data-ctx="${esc(mk)}"><button class="lk" data-doc="${esc(id)}" ${padOf(depth)} title="${esc(n.path)}"><span class="chev sp10"></span>${fileIcon(n.name)}<span class="nm">${esc(n.name)}</span>${isDirtyPath(p.id, n.path) ? '<i class="dirty"></i>' : ''}</button>${moreBtn(mk)}${menuHTML(p, mk)}</div>`;
      }
    }
    return h;
  };

  let h = `<button class="row ${t.pane === 'start' ? 'active' : ''}" data-act="proj-start"><span class="ic-ac">${ICON.spark}</span><span class="nm">Gemini</span></button>`;

  h += section('sec:files', p.external ? 'Files' : 'Files', p.codeFiles.length,
    sbtn('New file', 'data-edit="newFile" data-parent=""', SECTION_ICON.file) + sbtn('New folder', 'data-edit="newFolder" data-parent=""', SECTION_ICON.folder));
  if (open.has('sec:files')) {
    const rows = fileRows(p.tree, 1, '');
    h += rows || '<div class="row none">no files yet. Use + to add one</div>';
    if (p.treeTruncated) h += '<div class="row none">(showing the first 3000 files)</div>';
  }

  h += section('sec:sources', 'Sources', p.events.length,
    sbtn('Add a link', 'data-act="add-link" data-col=""', SECTION_ICON.link) + sbtn('New collection', 'data-edit="newCollection"', SECTION_ICON.folder));
  if (open.has('sec:sources')) {
    if (edit && edit.kind === 'newCollection') h += editRow(padOf(1), `<span class="chev sp10"></span><span class="ic-f">${ICON.folder}</span>`);
    for (const c of p.collections) {
      const evs = p.events.filter(e => e.type === c.id);
      const info = colInfo(c.id), k = 'col:' + c.id, mk = 'c:' + c.id;
      h += edit && edit.kind === 'renameCollection' && edit.target === c.id
        ? editRow(padOf(1), `${ICON.chev}<span class="ic-f">${ICON.folder}</span>`)
        : `<div class="row tree-row ${openMenu === mk ? 'menuopen' : ''}" data-ctx="${esc(mk)}"><button class="lk folder ${open.has(k) ? 'open' : ''}" data-folder="${esc(k)}" ${padOf(1)}>${ICON.chev}<span class="ic-f">${ICON.folder}</span><span class="nm">${esc(c.name)}</span><span class="cnt">${evs.length}</span></button>${moreBtn(mk)}${menuHTML(p, mk)}</div>`;
      if (!open.has(k)) continue;
      if (!evs.length) { h += `<div class="row none" ${padOf(2)}>nothing filed yet</div>`; continue; }
      h += evs.map(e => {
        const on = cur && e.url.split('#')[0] === cur;
        const mk2 = 's:' + e.id;
        return `<div class="row tree-row link ${on || docSel === 'event:' + e.id ? 'active' : ''} ${e.status === 'rejected' ? 'rejected' : ''} ${openMenu === mk2 ? 'menuopen' : ''}" data-ctx="${esc(mk2)}">
          <button class="lk" data-url="${esc(e.url)}" title="${esc(e.url)}" ${padOf(2)}><span class="${info.cls}">${info.icon}</span><span class="nm">${esc(shortTitle(e))}</span>${e.status === 'suggested' ? '<span class="sugg" title="Suggested by Gemini. Use ⋮ → Mark as chosen once you pick it">○</span>' : ''}</button>
          ${moreBtn(mk2)}${menuHTML(p, mk2)}</div>`;
      }).join('');
    }
  }

  h += section('sec:plan', 'Plan', null, sbtn('New phase', 'data-edit="newPhase"', SECTION_ICON.plus));
  if (open.has('sec:plan')) {
    for (const ph of p.phases) {
      const mk = 'p:' + ph;
      h += edit && edit.kind === 'renamePhase' && edit.target === ph
        ? editRow(padOf(1), `<span class="ic-ph">${ICON.flag}</span>`)
        : `<div class="row tree-row ${docSel === 'phase:' + ph ? 'active' : ''} ${openMenu === mk ? 'menuopen' : ''}" data-ctx="${esc(mk)}"><button class="lk" data-doc="phase:${esc(ph)}" ${padOf(1)}><span class="ic-ph">${ICON.flag}</span><span class="nm">${esc(ph)}.md</span>${ph === p.phase ? '<span class="curph" title="Current phase">current</span>' : ''}${(pr => pr ? `<span class="cnt ${pr.done === pr.total ? 'alldone' : ''}" title="${pr.done} of ${pr.total} tasks done">${pr.done}/${pr.total}</span>` : '')(progress((p.phaseNotes || {})[ph]))}</button>${moreBtn(mk)}${menuHTML(p, mk)}</div>`;
    }
    if (edit && edit.kind === 'newPhase') h += editRow(padOf(1), `<span class="ic-ph">${ICON.flag}</span>`);
    h += `<div class="row tree-row ${docSel === 'decisions' ? 'active' : ''}"><button class="lk" data-doc="decisions" ${padOf(1)}><span class="ic-ac">${ICON.file}</span><span class="nm">decisions.md</span><span class="cnt">${(p.decisions || []).length}</span></button></div>`;
  }

  return sideFrame(p, `<div class="tree" id="sideTree">${h}</div>`);
}
// Header shared by the Files and Source Control views
function sideFrame(p, body) {
  const view = sideView[p.id] || 'files';
  const changes = gitState[p.id] && gitState[p.id].files ? gitState[p.id].files.length : 0;
  return `<div class="sideh">
      <span class="ic-ac">${ICON.folder}</span><strong title="${esc(p.root)}">${esc(p.id)}</strong>
      <div class="hmenu ${openMenu === 'proj:' + p.id ? 'menuopen' : ''}">${moreBtn('proj:' + p.id)}${menuHTML(p, 'proj:' + p.id)}</div>
      <button class="sidebtn" data-act="toggle-side" title="Hide sidebar (Cmd+B)" aria-label="Hide sidebar">${ICON.collapse}</button>
      <button class="sidebtn" data-act="close-project" title="Close project" aria-label="Close project">×</button>
    </div>
    <div class="views" role="tablist">
      <button role="tab" class="${view === 'files' ? 'on' : ''}" data-view="files" aria-selected="${view === 'files'}">${FILES_ICON}Explorer</button>
      <button role="tab" class="${view === 'git' ? 'on' : ''}" data-view="git" aria-selected="${view === 'git'}">${SCM_ICON}Source Control${changes ? `<span class="badge">${changes}</span>` : ''}</button>
    </div>
    ${view === 'files' ? `<div class="sidephase"><span class="tag">${esc(p.phase)}</span>${p.events.length} sources</div>` : ''}
    ${body}
    <div class="exf">On disk: <code>${esc(p.folder)}</code></div>`;
}

/* ---------- editing names inline (new file, rename, new phase …) ---------- */
function startEdit(kind, data) {
  const p = P; if (!p) return;
  const open = openFolders[p.id];
  edit = { kind, parent: data.parent ?? null, target: data.target ?? null };
  let value = '';
  if (kind === 'rename') value = base(edit.target);
  if (kind === 'renameCollection') value = colName(p, edit.target);
  if (kind === 'renamePhase') value = edit.target.replace(/^\d+-/, '');
  if (kind === 'newFile' || kind === 'newFolder') { open.add('sec:files'); if (edit.parent) open.add('dir:' + edit.parent); }
  if (kind === 'newCollection') open.add('sec:sources');
  if (kind === 'newPhase' || kind === 'renamePhase') open.add('sec:plan');
  edit.value = value;
  openMenu = null;
  render();
}
async function commitEdit(cancel) {
  if (!edit || !P) return;
  const e = edit, pid = P.id;
  const name = ($('#rowEdit') ? $('#rowEdit').value : e.value || '').trim();
  edit = null;
  if (cancel || !name || (name === e.value && /^rename/.test(e.kind))) { render(); return; }
  if (/[\\/]/.test(name) && e.kind !== 'newFile' && e.kind !== 'newFolder') { toast('Names can’t contain slashes'); render(); return; }
  const join = (dir, n) => (dir ? dir + '/' + n : n);
  let r;
  if (e.kind === 'newFile') r = await api.editProject(pid, 'newFile', { path: join(e.parent, name) });
  else if (e.kind === 'newFolder') r = await api.editProject(pid, 'newFolder', { path: join(e.parent, name) });
  else if (e.kind === 'rename') {
    const from = e.target, to = join(from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '', name);
    if (anyDirtyUnder(pid, from)) { toast('Save or close the open file first'); render(); return; }
    r = await api.editProject(pid, 'rename', { from, to });
    if (r.ok) retargetOpenFiles(pid, from, r.path);
  }
  else if (e.kind === 'newCollection') { r = await api.editProject(pid, 'newCollection', { name }); if (r.ok) openFolders[pid].add('col:' + r.id); }
  else if (e.kind === 'renameCollection') r = await api.editProject(pid, 'renameCollection', { id: e.target, name });
  else if (e.kind === 'newPhase') r = await api.editProject(pid, 'newPhase', { name });
  else if (e.kind === 'renamePhase') r = await api.editProject(pid, 'renamePhase', { phase: e.target, name });
  if (r && r.error) toast(r.error);
  else if (r && e.kind === 'newFile') api.setPane('doc', 'file:' + r.path);   // open the new file
  render();
}
// open editor tabs follow a renamed or deleted file/folder
const under = (p, root) => p === root || p.startsWith(root + '/');
function anyDirtyUnder(pid, root) { for (const [k, ent] of models) if (k.startsWith(pid + '\u0000') && under(ent.path, root) && isDirty(ent)) return true; return false; }
function dropOpenFiles(pid, root) {
  for (const [k, ent] of [...models]) if (k.startsWith(pid + '\u0000') && under(ent.path, root)) { ent.model.dispose(); models.delete(k); }
  for (const id of Object.keys(itemsByTab)) itemsByTab[id] = itemsByTab[id].filter(x => !(x.startsWith('file:') && under(x.slice(5), root)));
}
function retargetOpenFiles(pid, from, to) {
  const t = activeTab();
  const wasActive = t && t.docPath && t.docPath.startsWith('file:') && under(t.docPath.slice(5), from) ? t.docPath.slice(5) : null;
  dropOpenFiles(pid, from);
  if (wasActive) api.setPane('doc', 'file:' + to + wasActive.slice(from.length));
}

/* ---------- project search page and notes ---------- */
const docChip = (doc, label, icon = ICON.file) => `<button class="chip" data-doc="${esc(doc)}">${icon}${esc(label)}</button>`;
const evChip = e => docChip('event:' + e.id, shortTitle(e), (TYPE[e.type] || TYPE.research).icon);

function renderDoc(t, p) {
  const sel = t.docPath || 'decisions';
  const i = sel.indexOf(':');
  const [kind, val] = i > 0 ? [sel.slice(0, i), sel.slice(i + 1)] : [sel, ''];
  let body;
  if (kind === 'event') {
    const e = p.events.find(x => x.id === val);
    body = !e ? '<div class="doc"><p class="empty">This source was removed.</p></div>' : `<div class="doc">
      <div><span class="tag">${esc(e.type)}</span><span class="tag">${esc(e.status || 'kept')}</span>${e.phase ? `<span class="tag">${esc(e.phase)}</span>` : ''}</div>
      <h1>${esc(shortTitle(e))}</h1>
      <button class="url" data-url="${esc(e.url)}" title="Open this page">${esc(e.url)}</button>
      <dl class="facts">
        <div><dt>Captured by</dt><dd>${esc(e.tool || 'browser')}</dd></div>
        <div><dt>When</dt><dd>${esc(e.time)}</dd></div>
        <div><dt>Phase</dt><dd>${esc(e.phase || 'untagged')}</dd></div>
        <div><dt>Search terms</dt><dd>${esc(e.query || '—')}</dd></div>
      </dl>
      <h2>Why it's here</h2><div class="why">${esc(e.why || '')}</div>
      <h2>Used in</h2>${(e.usedIn || []).length ? `<div class="chips">${e.usedIn.map(f => docChip('file:' + f, f)).join('')}</div>` : '<p class="empty">Not used in any file yet.</p>'}
    </div>`;
  } else if (kind === 'phase') {
    const ci = p.phases.indexOf(p.phase), pi = p.phases.indexOf(val);
    const items = [
      ...p.events.filter(e => e.phase === val).map(e => ({ t: e.time, e })),
      ...(p.decisions || []).filter(x => x.phase === val).map(x => ({ t: x.time, dec: x }))
    ].sort((a, b) => String(a.t).localeCompare(String(b.t)));
    body = `<div class="doc">
      <div><span class="tag">Phase ${pi + 1} of ${p.phases.length}</span><span class="tag">${pi < ci ? 'done' : pi === ci ? 'in progress' : 'upcoming'}</span></div>
      <h1>${esc(val)}</h1>
      ${(pr => pr ? `<div class="pbar" role="progressbar" aria-valuenow="${pr.done}" aria-valuemax="${pr.total}"><i style="width:${Math.round(100 * pr.done / pr.total)}%"></i></div><p class="empty">${pr.done} of ${pr.total} tasks done${pi !== ci ? ` · <button class="linkbtn" data-op="currentPhase" data-phase="${esc(val)}">Make this the current phase</button>` : ''}</p>` : '')(progress((p.phaseNotes || {})[val]))}
      <div class="md notes" data-phase="${esc(val)}">${md((p.phaseNotes || {})[val] || 'No plan yet. Ask Gemini to plan the project and the phases fill in with goals and tasks.', { tasks: true })}</div>
      <h2>What happened, in order</h2>
      ${items.length ? `<ol class="timeline">${items.map(it => it.dec
        ? `<li class="tl decision"><time>${esc(it.t)}</time><button class="t" data-doc="decisions">Decided: ${esc(it.dec.title)}</button><p>${esc(it.dec.detail)}</p></li>`
        : `<li class="tl ${esc(it.e.type)}"><time>${esc(it.t)}</time><button class="t" data-url="${esc(it.e.url)}">${esc(shortTitle(it.e))}</button><p>${esc(it.e.why || '')}</p></li>`).join('')}</ol>`
        : '<p class="empty">Nothing in this phase yet.</p>'}
    </div>`;
  } else {
    const decs = p.decisions || [];
    body = `<div class="doc"><h1>Decisions</h1>
      ${decs.length ? decs.map(x => `<div class="decision"><h3>${esc(x.title)}</h3><p class="empty">${esc(x.time)} · ${esc(x.phase)}</p><p>${esc(x.detail)}</p>
        ${(x.sources || []).length ? `<div class="chips">${x.sources.map(id => p.events.find(e => e.id === id)).filter(Boolean).map(evChip).join('')}</div>` : ''}</div>`).join('')
        : '<p class="empty">No decisions recorded yet.</p>'}</div>`;
  }
  const host = $('#docHost');
  const scroll = host.scrollTop;
  host.innerHTML = body;
  host.scrollTop = scroll;
}

/* ---------- terminal ---------- */
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r(?!\n)/g, '');
const shortPath = p => String(p || '').replace(/^\/Users\/[^/]+/, '~');
function scrollTerm(force) {
  const o = $('#termOut'); if (!o) return;
  if (force || o.scrollHeight - o.scrollTop - o.clientHeight < 60) o.scrollTop = o.scrollHeight;
}
async function loadTerm(p) {
  const r = await api.termGet(p.id);
  if (!P || P.id !== p.id || !$('#termOut')) return;
  $('#termOut').textContent = stripAnsi(r.output) || 'Commands run in the project folder using your login shell.\n';
  $('#termCwd').textContent = shortPath(r.cwd);
  $('#termCwd').title = r.cwd || '';
  $('#termStop').hidden = !r.running;
  scrollTerm(true);
}
function onTermEvent(ev) {
  if (!P || ev.pid !== P.id) return;
  const o = $('#termOut'); if (!o) return;
  if (ev.data != null) {
    o.textContent += stripAnsi(ev.data);
    if (o.textContent.length > 200000) o.textContent = o.textContent.slice(-150000);
    scrollTerm(false);
  }
  if (ev.running != null) $('#termStop').hidden = !ev.running;
}

/* ---------- Gemini panel ---------- */
const STEP_ICON = { source: ICON.db, info: ICON.info, search: ICON.search, open: ICON.link, read: ICON.file, write: ICON.file, decision: ICON.flag, phase: ICON.flag, approve: ICON.term };
function stepHTML(s) {
  if (s.kind === 'approve') {
    const head = s.status === 'waiting' ? 'Gemini wants to run' : s.status === 'skipped' ? 'Skipped' : `Ran${s.exit != null ? ` · exit ${esc(s.exit)}` : ''}`;
    return `<li class="approve ${esc(s.status)}">
      <div class="aph">${ICON.term}<span>${head}</span></div>
      <code>${esc(s.command)}</code>
      ${s.reason ? `<small>${esc(s.reason)}</small>` : ''}
      ${s.status === 'waiting' ? `<div class="apb"><button class="btn primary" data-approve="${esc(s.id)}">Run</button><button class="btn" data-deny="${esc(s.id)}">Skip</button></div>` : ''}
    </li>`;
  }
  const srcType = s.kind === 'source' && (/^Filed (video|videos)/i.test(s.label) ? 'video' : /^Filed (repositor|repo)/i.test(s.label) ? 'repo' : /^Filed (research)/i.test(s.label) ? 'research' : 'dataset');
  const icon = srcType ? TYPE[srcType].icon : STEP_ICON[s.kind] || ICON.link;
  const inner = `<span class="ic-ac">${icon}</span><span>${esc(s.label)}</span>`;
  if (s.url) return `<li><button class="cstep" data-url="${esc(s.url)}" title="${esc(s.url)}">${inner}</button></li>`;
  if (s.doc) return `<li><button class="cstep" data-doc="${esc(s.doc)}">${inner}</button></li>`;
  return `<li><span class="cstep">${inner}</span></li>`;
}
function msgHTML(m) {
  if (m.role === 'user') return `<div class="cmsg user">${m.viewing ? `<small>viewing ${esc(base(m.viewing))}</small>` : ''}${esc(m.text)}</div>`;
  return `<div class="cmsg bot">
    ${m.steps && m.steps.length ? `<ul class="csteps">${m.steps.map(stepHTML).join('')}</ul>` : ''}
    ${m.text ? `<div class="md">${md(m.text)}</div>` : ''}
    ${m.error ? `<p class="cerr">${esc(m.error)}</p>` : ''}
    ${m.pending ? '<p class="typing">Gemini is working…</p>' : ''}
  </div>`;
}
async function renderChat(pid) {
  const logs = ['#chatMain', '#chatlog'].map(q => $(q)).filter(Boolean);
  if (!logs.length) return;
  for (const q of ['#gemModel', '#mainModel']) { const el = $(q); if (el) el.textContent = AG.hasKey ? AG.model : ''; }
  const forms = ['#gemForm', '#mainForm'].map(q => $(q)).filter(Boolean);
  if (!AG.hasKey) {
    const html = `<div class="chatintro"><p>Connect Gemini to learn and build this project with it: ask questions, get step-by-step explanations, and let it write code and run commands with your approval.</p>
      <button class="btn primary" data-act="open-settings">Add API key</button></div>`;
    logs.forEach(l => { l.innerHTML = html; });
    forms.forEach(f => f.classList.add('off'));
    return;
  }
  forms.forEach(f => f.classList.remove('off'));
  const c = await api.agentChat(pid);
  if (!P || P.id !== pid) return;
  document.querySelectorAll('[data-mode]').forEach(b => {
    const on = b.dataset.mode === c.mode;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
  const intro = c.mode === 'build'
    ? `<div class="chatintro"><h3>Build ${esc(pid)} with Gemini</h3><p>Describe what you want. Gemini plans it, writes files into the project, runs them (each command waits for your approval) and fixes what breaks.</p></div>`
    : `<div class="chatintro"><h3>Learn by building ${esc(pid)}</h3><p>Ask anything, like you would any AI assistant. Gemini explains from first principles, walks you through the build one step at a time with code you can try, and points you to real datasets and docs. Switch to <b>Build with me</b> when you want it to write the files for you.</p></div>`;
  const html = c.transcript.length ? c.transcript.map(msgHTML).join('') : intro;
  for (const log of logs) {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    log.innerHTML = html;
    if (nearBottom || c.running) log.scrollTop = log.scrollHeight;
  }
  forms.forEach(f => { const go = f.querySelector('.go'); if (go) go.disabled = c.running; });
}
function focusChat() { const i = $('#mainInput'); if (i) i.focus(); }
function viewContext() {
  const t = activeTab();
  if (!t || !t.project) return null;
  if (t.pane === 'doc' && (t.docPath || '').startsWith('file:')) {
    const rel = t.docPath.slice(5);
    const ent = models.get(t.project + '\u0000' + rel);
    return { kind: 'file', path: rel, content: ent ? ent.model.getValue() : undefined, dirty: ent ? isDirty(ent) : false };
  }
  if (t.pane === 'web') return { kind: 'page', title: t.title || t.url };
  return null;
}
function updateGemCtx(t) {
  const el = $('#gemCtx'); if (!el) return;
  const v = viewContext();
  el.innerHTML = v ? `Sees: <b>${esc(v.kind === 'file' ? v.path : v.title)}</b>${v.dirty ? ' (unsaved)' : ''}` : 'Sees: project files and notes';
}

// Small, safe markdown renderer for Gemini's replies (text is escaped first)
function md(src, opts = {}) {
  let taskNo = 0;
  const blocks = [];
  const s = String(src || '').replace(/```[\w+-]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<div class="codewrap"><button class="copy" data-copy title="Copy code">Copy</button><pre class="mdcode"><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\n\u0000${blocks.length - 1}\u0000\n`;
  });
  const inline = t => {
    const links = [];
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, txt, url) => { links.push([txt, url]); return `\u0001${links.length - 1}\u0001`; });
    t = t.replace(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, url => { links.push([url, url]); return `\u0001${links.length - 1}\u0001`; });
    t = esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    return t.replace(/\u0001(\d+)\u0001/g, (_, i) => `<button class="mdlink" data-url="${esc(links[i][1])}" title="${esc(links[i][1])}">${esc(links[i][0])}</button>`);
  };
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of s.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\u0000(\d+)\u0000$/))) { close(); html += blocks[m[1]]; }
    else if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } const cb = m[1].match(/^\[([ xX])\]\s*(.*)/);
      html += cb ? `<li class="task ${cb[1].trim() ? 'done' : ''}">${opts.tasks
        ? `<button class="box" data-task="${taskNo++}" role="checkbox" aria-checked="${!!cb[1].trim()}" aria-label="Done">${cb[1].trim() ? '✓' : ''}</button>`
        : `<span class="box" aria-hidden="true">${cb[1].trim() ? '✓' : ''}</span>`}${inline(cb[2])}</li>` : `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += `<ol start="${Number(m[1]) || 1}">`; list = 'ol'; } html += `<li>${inline(m[2])}</li>`; }
    else if (!line.trim()) close();
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

/* ---------- dialogs ---------- */
function openDialog(html) {
  $('#modal').innerHTML = html;
  $('#overlay').hidden = false;
  api.overlay(true);   // hide the web page so the dialog is visible
  const f = $('#modal').querySelector('input:not([disabled]), button'); if (f) f.focus();
}
function closeDialog() { $('#overlay').hidden = true; api.overlay(false); }

async function publishDialog(pid) {
  const gh = await api.githubStatus();
  if (!gh.hasToken || gh.error) {
    openDialog(`<h2>Publish to GitHub</h2><p class="sub">${gh.error ? esc(gh.error) : 'Vyuha needs a GitHub token to create repositories and push for you.'}</p>
      <ol class="steps"><li>Create a token on GitHub with the <b>repo</b> permission.</li><li>Paste it in Settings → GitHub.</li></ol>
      <div class="mactions"><button type="button" class="btn" data-act="gh-token-page">Create a token on GitHub</button><button type="button" class="btn primary" data-act="open-settings">Open Settings</button></div>`);
    return;
  }
  openDialog(`<h2>Publish to GitHub</h2>${gh.warning ? `<p class="notice">${esc(gh.warning)}</p>` : ''}<p class="sub">Creates a repository on <b>${esc(gh.login)}</b>'s account, commits the project and pushes it. Vyuha's own notes (.vyuha) are left out.</p>
    <form id="publishForm">
      <div class="field"><label for="pubName">Repository name</label><input id="pubName" value="${esc(pid)}" spellcheck="false" required></div>
      <label class="toggle"><input type="checkbox" id="pubPrivate" checked><span>Private repository<small>Only you (and people you invite) can see it.</small></span></label>
      <div class="mactions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Publish</button></div>
    </form>`);
}
function cloneDialog() {
  openDialog(`<h2>Clone a repository</h2><p class="sub">Copies a GitHub repository to your Mac and opens it as a project. Private repositories need a GitHub token in Settings.</p>
    <form id="cloneForm">
      <div class="field"><label for="cloneUrl">Repository</label><input id="cloneUrl" placeholder="https://github.com/owner/repo or owner/repo" spellcheck="false" required></div>
      <p class="err" id="cloneErr"></p>
      <div class="mactions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Clone</button></div>
    </form>`);
}

function newProjectDialog() {
  openDialog(`<h2>New project</h2><p class="sub">Creates a Vyuha project with a code folder and a planning phase. To use an existing folder, choose Open Folder instead.</p>
    <form id="newForm">
      <div class="field"><label for="npName">Project name</label><input id="npName" placeholder="e.g. weather-dashboard" required></div>
      <div class="field"><label for="npGoal">Goal in one line</label><input id="npGoal" placeholder="e.g. Show tomorrow's forecast for my city"></div>
      <p class="err" id="npErr"></p>
      <div class="mactions"><button type="button" class="btn" data-act="open-folder">Open Folder…</button><span class="sp"></span><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Create project</button></div>
    </form>`);
}
async function settingsDialog() {
  const s = await api.getSettings();
  const st = await api.agentStatus();
  const gh = await api.githubStatus();
  const keyPh = st.fromEnv ? 'Set by GEMINI_API_KEY' : st.hasKey ? `Saved (${st.hint}). Paste a new key to replace it` : 'Paste your key from Google AI Studio';
  const row = (id, on, title, note) => `<label class="toggle"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${title}<small>${note}</small></span></label>`;
  openDialog(`<h2>Settings</h2><p class="sub">What Vyuha saves while you browse inside a project.</p>
    <form id="settingsForm">
      ${row('setRes', s.logResearch, 'Research pages', 'Docs, articles and search results go to research/.')}
      ${row('setDs', s.logDatasets, 'Dataset pages', 'Hugging Face, Kaggle and open-data pages go to datasets/.')}
      ${row('setVd', s.logVideos, 'Videos', 'YouTube pages go to videos/.')}
      <h3 class="sech">GitHub</h3>
      <div class="field"><label for="ghToken">Personal access token</label><input id="ghToken" type="password" autocomplete="off" placeholder="${esc(gh.fromEnv ? 'Set by GITHUB_TOKEN' : gh.hasToken ? (gh.login ? `Signed in as ${gh.login}. Paste a new token to replace it` : 'Saved. Paste a new token to replace it') : 'ghp_… or github_pat_…')}" ${gh.fromEnv ? 'disabled' : ''}></div>
      <div class="keyrow"><button type="button" class="btn" data-act="gh-test">Save and test</button><button type="button" class="btn" data-act="gh-token-page">Create a token</button>${gh.hasToken && !gh.fromEnv ? '<button type="button" class="btn" data-act="gh-remove">Remove</button>' : ''}</div>
      <p class="keymsg ${gh.error || gh.warning ? 'bad' : gh.login ? 'ok' : ''}" id="ghMsg">${gh.error ? esc(gh.error) : gh.login ? `Signed in as ${esc(gh.login)}.${gh.warning ? ' ' + esc(gh.warning) : ''}` : 'Used to publish, push, pull and clone private repositories. Give it the "repo" permission. Stored encrypted in your keychain.'}</p>
      <h3 class="sech">Gemini, used inside projects</h3>
      <div class="field"><label for="gKey">API key</label><input id="gKey" type="password" autocomplete="off" placeholder="${esc(keyPh)}" ${st.fromEnv ? 'disabled' : ''}></div>
      <div class="field"><label for="gModel">Model</label><input id="gModel" value="${esc(s.model || '')}" spellcheck="false"></div>
      <div class="field"><label for="gFallback">Backup model (used when the main one is overloaded)</label><input id="gFallback" value="${esc(s.fallbackModel || '')}" spellcheck="false"></div>
      <div class="keyrow"><button type="button" class="btn" data-act="test-key">Save and test</button>${st.hasKey && !st.fromEnv ? '<button type="button" class="btn" data-act="remove-key">Remove key</button>' : ''}</div>
      <p class="keymsg" id="keyMsg">The key is encrypted with your Mac's keychain and only used by Vyuha's main process.</p>
      <div class="mactions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Save settings</button></div>
    </form>`);
}
async function saveGemini() {
  const key = ($('#gKey') || {}).value || '';
  if (key.trim()) await api.agentSetKey(key.trim());
  const model = (($('#gModel') || {}).value || '').trim();
  const fallbackModel = (($('#gFallback') || {}).value || '').trim();
  if (model) await api.setSettings({ model, fallbackModel });
}
async function refreshAgent() { AG = await api.agentStatus(); mainKey = ''; render(); if (P) renderChat(P.id); }

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { clearTimeout(toastTimer); t.hidden = true; action.fn(); };
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3000);
}

/* ---------- events ---------- */
async function runOp(pid, d) {
  const op = d.op;
  if (op === 'delete') {
    const what = d.dir ? `the folder ${d.path} and everything in it` : d.path;
    if (!window.confirm(`Move ${what} to the Trash?`)) return;
    if (anyDirtyUnder(pid, d.path) && !window.confirm('It has unsaved changes. Delete anyway?')) return;
    const r = await api.editProject(pid, 'delete', { path: d.path });
    if (r.error) return toast(r.error);
    const t = activeTab();
    if (t.docPath && t.docPath.startsWith('file:') && under(t.docPath.slice(5), d.path)) api.home();
    dropOpenFiles(pid, d.path);
    toast(`Moved ${base(d.path)} to the Trash`);
    return render();
  }
  if (op === 'deleteCollection') {
    const name = colName(P, d.id);
    if (!window.confirm(`Delete the collection "${name}"? Its sources move to research.`)) return;
  }
  if (op === 'deletePhase' && !window.confirm(`Delete phase ${d.phase}? Its notes are removed; its sources and decisions move to the previous phase.`)) return;
  const args = { id: d.id, phase: d.phase, dir: Number(d.dir) };
  const r = await api.editProject(pid, op, args);
  if (r.error) return toast(r.error);
  if (op === 'deleteCollection' && r.moved) toast(`${r.moved} source${r.moved === 1 ? '' : 's'} moved to research`);
  const t = activeTab();
  // keep showing the same phase if it was renumbered
  if ((op === 'movePhase') && t.docPath === 'phase:' + d.phase && r.phase) api.setPane('doc', 'phase:' + r.phase);
  if (op === 'deletePhase' && t.docPath === 'phase:' + d.phase) api.home();
}
function addLinkDialog(col) {
  const p = P; if (!p) return;
  openDialog(`<h2>Add a link</h2><p class="sub">File a page into ${esc(p.id)} by hand: a dataset, paper, tutorial or anything you want to keep.</p>
    <form id="linkForm">
      <div class="field"><label for="lkUrl">Address</label><input id="lkUrl" placeholder="https://…" required></div>
      <div class="field"><label for="lkTitle">Title</label><input id="lkTitle" placeholder="e.g. SMS Spam Collection (UCI)"></div>
      <div class="field"><label for="lkCol">Collection</label><select id="lkCol" class="sel">
        <option value="">Choose automatically</option>
        ${p.collections.map(c => `<option value="${esc(c.id)}" ${c.id === col ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="lkWhy">Why it's useful (optional)</label><input id="lkWhy"></div>
      <p class="err" id="lkErr"></p>
      <div class="mactions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Add link</button></div>
    </form>`);
}
document.addEventListener('contextmenu', ev => {
  const row = ev.target.closest('[data-ctx]');
  if (!row) return;
  ev.preventDefault();
  openMenu = row.dataset.ctx; edit = null;
  render();
});
async function copyCode(btn) {
  const code = btn.parentElement.querySelector('code').textContent;
  try { await navigator.clipboard.writeText(code); }
  catch (e) {
    const r = document.createRange(); r.selectNodeContents(btn.parentElement.querySelector('code'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); sel.removeAllRanges();
  }
  btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
}
function closeMenu() { if (!openMenu) return; openMenu = null; const t = S && activeTab(); if (t && t.project) render(); }
window.addEventListener('blur', closeMenu);   // e.g. clicking into the web page

document.addEventListener('click', ev => {
  const x = ev.target.closest('[data-close]');
  if (x) { ev.stopPropagation(); api.closeTab(x.dataset.close); return; }
  const ci = ev.target.closest('[data-close-item]');
  if (ci) { ev.stopPropagation(); closeItem(ci.dataset.closeItem); return; }
  const tab = ev.target.closest('[data-tab]');
  if (tab) { api.activate(tab.dataset.tab); return; }
  const item = ev.target.closest('[data-item]');
  if (item) { goItem(item.dataset.item); return; }
  if (ev.target === $('#overlay')) { closeDialog(); return; }
  if (openMenu && !ev.target.closest('.rowmenu, [data-menu]')) closeMenu();
  if (edit && !ev.target.closest('.editing')) commitEdit(false);
  const el = ev.target.closest('button');
  if (!el || !S) return;
  const t = activeTab();
  const act = el.dataset.act;
  if (el.dataset.mode && P) { api.agentSetMode(P.id, el.dataset.mode); return; }
  if (el.hasAttribute('data-copy')) { copyCode(el); return; }
  if (act === 'focus-chat') { focusChat(); return; }
  if (el.dataset.menu) { openMenu = openMenu === el.dataset.menu ? null : el.dataset.menu; render(); return; }
  if (el.closest('.rowmenu')) openMenu = null;
  if (el.dataset.view && t.project) {
    sideView[t.project] = el.dataset.view;
    if (el.dataset.view === 'git') refreshGit(t.project);
    render(); return;
  }
  if (el.dataset.git && t.project) {
    const pid = t.project, op = el.dataset.git;
    if (op === 'refresh') refreshGit(pid);
    else if (op === 'gitignore') gitAction(pid, 'gitignore').then(r => { if (r.ok) toast('Added .gitignore'); });
    else if (op === 'commit') gitAction(pid, 'commit', { message: commitDraft[pid] || '' });
    else if (op === 'suggest') {
      gitBusy[pid] = 'suggestMessage'; render();
      api.gitOp(pid, 'suggestMessage').then(r => { gitBusy[pid] = null; if (r.error) toast(r.error); else commitDraft[pid] = r.message; render(); });
    }
    else gitAction(pid, op);
    return;
  }
  if (el.dataset.diff && t.project) { api.setPane('doc', 'diff:' + el.dataset.diff); return; }
  if (act === 'publish' && t.project) { publishDialog(t.project); return; }
  if (act === 'clone') { cloneDialog(); return; }
  if (act === 'reveal-project' && t.project) { api.revealProject(t.project); return; }
  if (act === 'delete-project' && t.project) { api.deleteProject(t.project); return; }
  if (act === 'gh-token-page') { closeDialog(); window.open('https://github.com/settings/tokens/new?scopes=repo&description=Vyuha'); return; }
  if (el.dataset.edit) { startEdit(el.dataset.edit, { parent: el.dataset.parent, target: el.dataset.target }); return; }
  if (el.dataset.task != null && t.project) {
    const ph = el.closest('[data-phase]').dataset.phase;
    api.editProject(t.project, 'toggleTask', { phase: ph, index: Number(el.dataset.task) }).then(r => { if (r.error) toast(r.error); });
    return;
  }
  if (el.dataset.op && t.project) { runOp(t.project, el.dataset); return; }
  if (act === 'add-link') { addLinkDialog(el.dataset.col || ''); return; }
  if (el.id === 'newTab') api.newTab();
  else if (el.id === 'back') api.back();
  else if (el.id === 'fwd') api.forward();
  else if (el.id === 'reload') api.reload();
  else if (el.id === 'home') api.home();
  else if (el.dataset.folder && t.project) {
    const s = openFolders[t.project];
    s.has(el.dataset.folder) ? s.delete(el.dataset.folder) : s.add(el.dataset.folder);
    render();
  }
  else if (el.dataset.keep && t.project) api.updateEvent(t.project, el.dataset.keep, { status: 'kept' }).then(() => toast('Marked as chosen'));
  else if (el.dataset.move && t.project) api.updateEvent(t.project, el.dataset.move, { type: el.dataset.to }).then(() => toast(`Moved to ${colName(P, el.dataset.to)}`));
  else if (el.dataset.approve) api.agentApprove(el.dataset.approve, true);
  else if (el.dataset.deny) api.agentApprove(el.dataset.deny, false);
  else if (el.dataset.url) api.openLink(el.dataset.url);
  else if (el.dataset.doc) api.setPane('doc', el.dataset.doc);
  else if (el.dataset.del && t.project) {
    const showingIt = t.pane === 'doc' && t.docPath === 'event:' + el.dataset.del;
    api.deleteEvent(t.project, el.dataset.del).then(() => {
      if (showingIt) api.setPane(t.hasView ? 'web' : 'start');
      toast('Removed from project');
    });
  }
  else if (act === 'proj-start') api.home();
  else if (act === 'preview') previewCurrent();
  else if (act === 'toggle-side') { sideCollapsed = !sideCollapsed; render(); }
  else if (act === 'toggle-term') toggleTerm();
  else if (act === 'toggle-gem') toggleGem();
  else if (act === 'term-stop' && P) api.termStop(P.id);
  else if (act === 'term-clear' && P) { api.termClear(P.id); $('#termOut').textContent = ''; }
  else if (act === 'close-project') api.closeProject();
  else if (act === 'open-folder') { closeDialog(); api.openFolder(); }
  else if (act === 'open-settings') settingsDialog();
  else if (act === 'close-dialog') closeDialog();
  else if (act === 'clear-chat' && P) api.agentClear(P.id);
  else if (act === 'test-key') {
    const msg = $('#keyMsg');
    msg.className = 'keymsg'; msg.textContent = 'Testing…';
    saveGemini().then(() => api.agentTest()).then(r => {
      msg.className = 'keymsg ' + (r.ok ? 'ok' : 'bad'); msg.textContent = r.message;
      if (r.ok) $('#gKey').value = '';
      refreshAgent();
    });
  }
  else if (act === 'gh-test') {
    const msg = $('#ghMsg'); const tok = $('#ghToken').value.trim();
    msg.className = 'keymsg'; msg.textContent = 'Checking…';
    (tok ? api.githubSetToken(tok) : Promise.resolve()).then(() => api.githubStatus()).then(g => {
      msg.className = 'keymsg ' + (g.login && !g.warning ? 'ok' : 'bad');
      msg.textContent = g.login ? `Signed in as ${g.login}.${g.warning ? ' ' + g.warning : ''}` : (g.error || 'No token saved yet.');
      if (g.login) $('#ghToken').value = '';
    });
  }
  else if (act === 'gh-remove') api.githubSetToken('').then(() => { closeDialog(); toast('GitHub token removed'); });
  else if (act === 'remove-key') api.agentSetKey('').then(() => { closeDialog(); refreshAgent(); toast('Gemini key removed'); });
});

document.addEventListener('input', ev => {
  if (ev.target.id === 'commitMsg' && P) commitDraft[P.id] = ev.target.value;
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'fileTo' && ev.target.value) {
    const pid = ev.target.value;
    ev.target.blur();
    api.fileTab(pid);
    toast(`Filing this tab to ${pid}`);
  }
});

document.addEventListener('keydown', ev => {
  if (ev.target.id === 'rowEdit') {
    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit(false); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); commitEdit(true); return; }
    return;
  }
  if (ev.key === 'Escape') { if (openMenu) closeMenu(); if (!$('#overlay').hidden) closeDialog(); }
  if (ev.key === 'Enter' && ev.target.dataset) {
    if (ev.target.dataset.tab) api.activate(ev.target.dataset.tab);
    if (ev.target.dataset.item) goItem(ev.target.dataset.item);
  }
  if ((ev.target.id === 'gemInput' || ev.target.id === 'mainInput') && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault(); ev.target.form.requestSubmit();
  }
  if (ev.target.id === 'termInput' && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && termHistory.length) {
    ev.preventDefault();
    termHistIdx = ev.key === 'ArrowUp' ? Math.max(0, termHistIdx < 0 ? termHistory.length - 1 : termHistIdx - 1)
                                       : Math.min(termHistory.length, termHistIdx + 1);
    ev.target.value = termHistory[termHistIdx] || '';
  }
});

document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'homeForm') {
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const res = await api.prompt(text);
    if (res && res.kind === 'web' && res.filed && !res.fromProject) {
      toast(`Filing to ${res.filed}`, { label: 'Undo', fn: () => api.unfileTab(true) });
    }
  }
  if ((f.id === 'gemForm' || f.id === 'mainForm') && P) {
    const input = f.querySelector('textarea');
    const text = input.value.trim();
    if (!text || !AG.hasKey) return;
    input.value = '';
    const r = await api.agentAsk(P.id, text, f.id === 'gemForm' ? viewContext() : null);
    if (r && r.error) toast(r.error);
  }
  if (f.id === 'termForm' && P) {
    const input = $('#termInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    termHistory.push(cmd); termHistIdx = -1;
    input.value = '';
    const r = await api.termRun(P.id, cmd);
    if (r && r.error) toast(r.error);
  }
  if (f.id === 'addrForm') {
    const a = $('#address');
    const text = a.value.trim();
    a.blur();
    if (text && !text.startsWith('vyuha://')) await api.navigate(text);
    render();
  }
  if (f.id === 'publishForm' && P) {
    const name = $('#pubName').value.trim();
    closeDialog();
    const r = await gitAction(P.id, 'publish', { name, private: $('#pubPrivate').checked });
    if (r.ok && r.url) toast(`Published to ${r.url.replace('https://github.com/', '')}`);
  }
  if (f.id === 'cloneForm') {
    const btn = f.querySelector('.primary'); btn.disabled = true; btn.textContent = 'Cloning…';
    const r = await api.gitClone($('#cloneUrl').value);
    btn.disabled = false; btn.textContent = 'Clone';
    if (r.error) { $('#cloneErr').textContent = r.error; return; }
    if (!r.cancelled) { closeDialog(); toast('Cloned and opened'); }
  }
  if (f.id === 'linkForm' && P) {
    const r = await api.editProject(P.id, 'addLink', { url: $('#lkUrl').value, title: $('#lkTitle').value, collection: $('#lkCol').value, why: $('#lkWhy').value });
    if (r.error) { $('#lkErr').textContent = r.error; return; }
    closeDialog(); toast('Link added');
  }
  if (f.id === 'newForm') {
    const res = await api.createProject($('#npName').value, $('#npGoal').value.trim());
    if (res.error) { $('#npErr').textContent = res.error; return; }
    closeDialog();
  }
  if (f.id === 'settingsForm') {
    await saveGemini();
    const tok = ($('#ghToken') || {}).value; if (tok && tok.trim()) await api.githubSetToken(tok.trim());
    await api.setSettings({ logResearch: $('#setRes').checked, logDatasets: $('#setDs').checked, logVideos: $('#setVd').checked });
    closeDialog();
    await refreshAgent();
    toast('Settings saved');
  }
});
