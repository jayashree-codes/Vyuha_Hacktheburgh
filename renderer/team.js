// Team context UI: Source Control block, publish review, Team page, phase-page ownership controls,
// terminal banner for known errors. Loaded after app.js and uses its helpers (api, $, esc, md, render, toast…).
// Nothing here shows up for a project until team context is set up for it (except the Set up button).

const TEAM = {};          // project id -> last team view from the main process (or null while loading)
const teamTab = {};       // project id -> Team page tab
const teamBanner = {};    // project id -> latest "a teammate fixed this" event from the terminal
const teamBusy = {};      // project id -> running action

async function refreshTeam(pid) {
  const r = await api.teamState(pid);
  TEAM[pid] = r && r.ok ? r : { enabled: false, error: r && r.error };
  if (P && P.id === pid) render();
}
function teamOf(p) {
  if (TEAM[p.id] === undefined) { TEAM[p.id] = null; setTimeout(() => refreshTeam(p.id), 0); }
  return TEAM[p.id];
}
const tName = (v, id) => ((v.fold.members || []).find(m => m.id === id) || { name: id || 'nobody' }).name;
const when = iso => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

function onTeamEvent(ev) {
  if (!ev || !ev.pid) return;
  if (ev.kind === 'rejected') toast(`Not allowed: ${ev.reason}`);
  if (ev.kind === 'match') { teamBanner[ev.pid] = ev; renderTeamBanner(); }
  if (ev.kind === 'resolved') toast(`Fixed: ${ev.issues.map(i => i.title).join(', ')}. Publish context to share the fix with your team.`);
  refreshTeam(ev.pid);
}

/* ---------- sidebar + Source Control ---------- */
function teamSideRow(p, docSel, pad) {
  const v = teamOf(p);
  if (!v || !v.enabled) return '';
  return `<div class="row tree-row ${docSel && docSel.startsWith('team') ? 'active' : ''}"><button class="lk" data-doc="team" ${pad}><span class="ic-ac">${ICON.folder}</span><span class="nm">Team</span><span class="cnt">${v.fold.members.length}</span></button></div>`;
}
function teamScmHTML(p, g) {
  const v = teamOf(p);
  const busy = teamBusy[p.id];
  const head = '<div class="scmh">Team context</div>';
  if (!v) return head + '<p class="empty sm">Checking…</p>';
  if (!v.enabled) {
    return `${head}<div class="teamscm"><p class="empty sm">Share the plan, who owns what, decisions and fixes for errors with everyone on this repository. It lives on its own branch (vyuha_context); your code branches are untouched.</p>
      <button class="btn wide" data-team="setup" ${busy || !g.remote ? 'disabled' : ''} title="${g.remote ? '' : 'Publish this project to GitHub first'}">${busy === 'setup' ? 'Setting up…' : 'Set up team context'}</button>
      ${g.remote ? '' : '<p class="empty sm">Publish this project to GitHub first.</p>'}</div>`;
  }
  return `${head}<div class="teamscm">
    <div class="scmrow"><button class="linkbtn" data-doc="team">${v.fold.members.length} member${v.fold.members.length === 1 ? '' : 's'} · ${v.fold.phases.length} phases</button></div>
    <div class="scmrow"><button class="btn sm" data-team="pull" ${busy ? 'disabled' : ''}>${busy === 'pull' ? 'Pulling…' : 'Pull context'}</button>
      <button class="btn sm primary" data-team="publish" ${busy ? 'disabled' : ''}>${busy === 'publish' ? 'Publishing…' : 'Publish context'}</button></div>
    <p class="empty sm">Last published: ${esc(when(v.settings.lastPublished))}</p></div>`;
}

/* ---------- publish review ---------- */
async function teamPublishDialog(pid) {
  const r = await api.teamPending(pid);
  if (r.error) return toast(r.error);
  const drafts = r.drafts || [];
  openDialog(`<h2>Publish team context</h2>
    <p class="sub">Sends ${r.newEvents} new plan event${r.newEvents === 1 ? '' : 's'} and the issue cards you tick below to the vyuha_context branch. Your prompts, chat and behaviour data never leave this computer.</p>
    <form id="teamPublishForm">
      ${drafts.length ? `<h3 class="sech">New issues</h3>` + drafts.map(d => `<fieldset class="tdraft" data-id="${esc(d.id)}">
        <label class="toggle"><input type="checkbox" name="include" ${d.include ? 'checked' : ''}><span>${esc(d.status === 'fixed' ? 'Fixed' : 'Still open')} · <code>${esc(d.command)}</code><small>${esc(d.errorType || '')} · ${d.attempts} attempt${d.attempts === 1 ? '' : 's'}${(d.filesChanged || []).length ? ' · ' + esc(d.filesChanged.join(', ')) : ''}</small></span></label>
        <div class="field"><label>Title</label><input name="title" value="${esc(d.title)}"></div>
        <div class="field"><label>Symptom</label><textarea name="symptom" rows="2">${esc(d.symptom)}</textarea></div>
        <div class="field"><label>Cause</label><textarea name="cause" rows="2">${esc(d.cause)}</textarea></div>
        <div class="field"><label>Fix</label><textarea name="fix" rows="2">${esc(d.fix)}</textarea></div>
      </fieldset>`).join('') : '<p class="empty">No new issues to review.</p>'}
      <label class="toggle"><input type="checkbox" id="tpStyle" ${r.shareStyle ? 'checked' : ''}><span>Share my answer style<small>Teammates can choose "Answer like you". Only learned weights and rules are shared, never your messages or typing.</small></span></label>
      <div class="mactions"><button type="button" class="btn" data-act="close-dialog">Cancel</button><button class="btn primary">Publish</button></div>
    </form>`);
}
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'teamPublishForm' || !P) return;
  const pid = P.id;
  const drafts = [...ev.target.querySelectorAll('.tdraft')].map(fs => ({
    id: fs.dataset.id, include: fs.querySelector('[name=include]').checked,
    title: fs.querySelector('[name=title]').value, symptom: fs.querySelector('[name=symptom]').value,
    cause: fs.querySelector('[name=cause]').value, fix: fs.querySelector('[name=fix]').value }));
  closeDialog();
  teamBusy[pid] = 'publish'; render();
  const r = await api.teamPublish(pid, { drafts, shareStyle: $('#tpStyle') ? $('#tpStyle').checked : false });
  teamBusy[pid] = null;
  if (r.error) toast(r.error); else { toast(r.nothing ? 'Nothing new to publish' : 'Team context published'); TEAM[pid] = r; }
  render();
});

/* ---------- phase page: owner, assignees, claim, hand off, take over ---------- */
function teamPhaseHTML(p, local) {
  const v = TEAM[p.id];
  if (!v || !v.enabled) return '';
  const id = Object.keys(v.phaseMap || {}).find(k => v.phaseMap[k] === local);
  const ph = id && v.fold.phases.find(x => x.id === id);
  if (!ph) return '';
  const me = v.me.id;
  const others = v.fold.members.filter(m => m.id !== me);
  const sel = (name, list) => `<select class="sel sm" data-teamsel="${name}">${list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>`;
  const blocked = v.blocked[ph.id];
  return `<div class="teamphase">
    <div class="tprow"><span class="tag">Owner</span><b>${ph.owner ? esc(tName(v, ph.owner)) : 'Nobody yet'}</b>
      <span class="empty sm">planned by ${esc(tName(v, ph.plannedBy))}${ph.takenFrom ? `, taken over from ${esc(tName(v, ph.takenFrom))}` : ''}</span></div>
    <div class="tprow">
      ${!ph.owner ? `<button class="btn sm" data-team="start" data-phase-id="${esc(ph.id)}">Start this phase</button>` : ''}
      ${ph.owner === me && others.length ? `${sel('handoff', others)}<button class="btn sm" data-team="handoff" data-phase-id="${esc(ph.id)}">Hand off</button>` : ''}
      ${ph.owner && ph.owner !== me ? `<button class="btn sm" data-team="takeover" data-phase-id="${esc(ph.id)}" ${blocked ? `disabled title="${esc(blocked)}"` : ''}>Take over</button>${blocked ? `<span class="empty sm">${esc(blocked)}</span>` : ''}` : ''}
      ${ph.takenFrom === me ? `<button class="btn sm" data-team="takeback" data-phase-id="${esc(ph.id)}">Take back</button>` : ''}
    </div>
    <ul class="tptasks">${ph.tasks.map(t => `<li class="${t.done ? 'done' : ''}"><span class="box" aria-hidden="true">${t.done ? '✓' : ''}</span><span class="tt">${esc(t.text)}</span>
      <span class="who">${t.assignee ? esc(tName(v, t.assignee)) : 'unassigned'}</span>
      ${t.assignee !== me ? `<button class="mini" data-team="claim" data-phase-id="${esc(ph.id)}" data-task-id="${esc(t.id)}">Claim</button>` : ''}
      ${sel('assign-' + t.id, v.fold.members)}<button class="mini" data-team="assign" data-phase-id="${esc(ph.id)}" data-task-id="${esc(t.id)}">Assign</button></li>`).join('') || '<li class="empty">No tasks yet.</li>'}</ul>
  </div>`;
}

/* ---------- Team page ---------- */
function issueCard(v, i) {
  const hay = [i.title, i.symptom, i.cause, i.fix, i.errorExcerpt, i.command, i.area, ...(i.filesChanged || [])].join(' ').toLowerCase();
  return `<div class="tcard ${i.status}" id="tc-${esc(i.id)}" data-search="${esc(hay)}">
    <h3>${esc(i.title)}</h3>
    <p class="empty sm">${i.status === 'fixed' ? 'Fixed' : 'Open'} by ${esc(tName(v, i.by))} · ${esc(when(i.resolvedAt || i.openedAt))} · <code>${esc(i.command)}</code>${i.errorType ? ` · ${esc(i.errorType)}` : ''}${i.area ? ` · ${esc(i.area)}` : ''}</p>
    ${i.symptom ? `<p><b>Symptom</b> ${esc(i.symptom)}</p>` : ''}${i.cause ? `<p><b>Cause</b> ${esc(i.cause)}</p>` : ''}${i.fix ? `<p><b>Fix</b> ${esc(i.fix)}</p>` : ''}
    ${(i.filesChanged || []).length ? `<div class="chips">${i.filesChanged.map(f => docChip('file:' + f, f)).join('')}</div>` : ''}
    <details><summary>Error output</summary><pre class="mdcode">${esc(i.errorExcerpt || '')}</pre></details>
  </div>`;
}
function teamPageHTML(p, val) {
  const v = teamOf(p);
  if (!v) return '<div class="doc"><p class="empty">Loading team context…</p></div>';
  if (!v.enabled) return `<div class="doc"><h1>Team</h1><p class="empty">Team context isn't set up for this project. Open Source Control and click <b>Set up team context</b>.</p></div>`;
  const focus = val && val.startsWith('issue:') ? val.slice(6) : null;
  const tab = focus ? 'issues' : teamTab[p.id] || 'overview';
  const tabs = [['overview', 'Overview'], ['issues', 'Issues and fixes'], ['decisions', 'Decisions'], ['timeline', 'Timeline'], ['styles', 'Answer styles']];
  const f = v.fold, me = v.me.id;
  let body = '';
  if (tab === 'overview') {
    body = `<table class="ttable"><thead><tr><th>#</th><th>Phase</th><th>Owner</th><th>Progress</th></tr></thead><tbody>
      ${f.phases.map((ph, i) => `<tr><td>${i + 1}</td><td><button class="linkbtn" data-doc="phase:${esc(v.phaseMap[ph.id] || '')}">${esc(ph.name)}</button></td><td>${ph.owner ? esc(tName(v, ph.owner)) : '<span class="empty">unowned</span>'}</td>
        <td><div class="pbar"><i style="width:${ph.progress.total ? Math.round(100 * ph.progress.done / ph.progress.total) : 0}%"></i></div>${ph.progress.done}/${ph.progress.total}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No phases yet.</td></tr>'}</tbody></table>
      <h2>Members</h2><ul class="tmembers">${f.members.map(m => `<li><b>${esc(m.name)}</b>${m.id === me ? ' (you)' : ''}${m.id === f.creator ? ' · created the team context' : ''}<span class="empty sm"> · last active ${esc(when(f.lastActivity[m.id]))}</span></li>`).join('')}</ul>
      ${f.rejected.length ? `<h2>Refused actions</h2><ul class="tmembers">${f.rejected.slice(-10).reverse().map(r => `<li>${esc(tName(v, r.event.by))}: ${esc(r.event.type)} <span class="empty sm">· ${esc(r.reason)}</span></li>`).join('')}</ul>` : ''}`;
  } else if (tab === 'issues') {
    body = `<input id="teamSearch" class="tsearch" placeholder="Search by error text, file or area" spellcheck="false">
      ${v.issues.length ? v.issues.slice().sort((a, b) => String(b.resolvedAt || b.openedAt).localeCompare(String(a.resolvedAt || a.openedAt))).map(i => issueCard(v, i)).join('') : '<p class="empty">No issues published yet. When a command fails and you fix it, Vyuha drafts a card for you to publish.</p>'}`;
  } else if (tab === 'decisions') {
    body = f.decisions.length ? f.decisions.map(d => `<div class="decision ${d.status}"><h3>${d.status === 'superseded' ? `<s>${esc(d.title)}</s>` : esc(d.title)}${d.area ? ` <span class="tag">${esc(d.area)}</span>` : ''}</h3>
      <p class="empty sm">${esc(tName(v, d.by))} · ${esc(when(d.at))}</p><p>${esc(d.detail)}</p>
      ${d.status === 'superseded' ? `<p class="empty sm">Superseded by ${esc(tName(v, d.supersededByPerson))}${d.supersededBy && f.decisions.find(x => x.id === d.supersededBy) ? ` with "${esc(f.decisions.find(x => x.id === d.supersededBy).title)}"` : ''}: ${esc(d.reason || 'no reason given')}</p>` : ''}</div>`).join('') : '<p class="empty">No team decisions yet.</p>';
  } else if (tab === 'timeline') {
    body = `<ol class="timeline">${f.timeline.map(e => `<li class="tl"><time>${esc(when(e.at))}</time><p>${esc(e.text)}</p></li>`).join('') || '<li class="empty">Nothing yet.</li>'}</ol>`;
  } else {
    const shared = Object.entries(v.styles || {}).filter(([id]) => id !== me);
    body = `<p class="empty">Borrow how a teammate likes answers. Their learned style is blended with yours and their rules are added as "borrowed"; your own history stays as it is. You can undo it.</p>
      ${shared.length ? `<ul class="tmembers">${shared.map(([id, s]) => `<li><b>${esc(tName(v, id))}</b> <span class="empty sm">${s.rules} rule${s.rules === 1 ? '' : 's'}</span> <button class="btn sm" data-team="import-style" data-person="${esc(id)}">Answer like ${esc(tName(v, id))}</button></li>`).join('')}</ul>` : '<p class="empty">Nobody has shared an answer style yet. Tick "Share my answer style" when you publish.</p>'}
      ${v.canUndoStyle ? '<button class="btn" data-team="undo-style">Undo the last imported style</button>' : ''}`;
  }
  if (focus) setTimeout(() => { const el = document.getElementById('tc-' + focus); if (el) { el.classList.add('focus'); el.scrollIntoView({ block: 'center' }); } }, 0);
  return `<div class="doc teampage"><h1>Team</h1>
    <p class="empty sm">${f.members.length} members · last published ${esc(when(v.settings.lastPublished))} · <button class="linkbtn" data-team="pull">Pull context</button> · <button class="linkbtn" data-team="publish">Publish context</button></p>
    <div class="ttabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${k === tab ? 'on' : ''}" data-team="tab" data-tab-key="${k}">${l}</button>`).join('')}</div>
    ${body}</div>`;
}
document.addEventListener('input', ev => {
  if (ev.target.id !== 'teamSearch') return;
  const q = ev.target.value.toLowerCase().trim();
  for (const c of document.querySelectorAll('.tcard')) c.hidden = !!q && !c.dataset.search.includes(q);
});

/* ---------- terminal banner ---------- */
function renderTeamBanner() {
  const el = $('#termBanner');
  if (!el || !P) return;
  const ev = teamBanner[P.id];
  if (!ev || !ev.cards || !ev.cards.length) { el.hidden = true; el.innerHTML = ''; return; }
  const c = ev.cards[0];
  el.hidden = false;
  el.innerHTML = `<span>${c.status === 'fixed' ? `${esc(c.by)} fixed this error before` : `${esc(c.by)} is also stuck on this`}: <b>${esc(c.title)}</b></span>
    <button class="mini" data-team="view-fix" data-issue="${esc(c.issueId)}">View fix</button>
    ${c.status === 'fixed' ? '<button class="mini" data-team="apply-fix">Ask Gemini to apply it</button>' : ''}
    <button class="mini" data-team="dismiss-banner" aria-label="Dismiss">×</button>`;
}
setInterval(() => { const el = $('#termBanner'); if (el && P && teamBanner[P.id] && el.hidden) renderTeamBanner(); }, 500);

/* ---------- clicks ---------- */
async function teamClick(pid, el) {
  const op = el.dataset.team;
  const busyOps = { setup: 1, pull: 1 };
  const done = r => { if (r && r.error) toast(r.error); else if (r) TEAM[pid] = r; render(); };
  if (op === 'tab') { teamTab[pid] = el.dataset.tabKey; api.setPane('doc', 'team'); render(); return; }
  if (op === 'publish') return teamPublishDialog(pid);
  if (busyOps[op]) {
    teamBusy[pid] = op; render();
    const r = op === 'setup' ? await api.teamSetup(pid) : await api.teamPull(pid);
    teamBusy[pid] = null;
    if (!r.error) toast(op === 'setup' ? 'Team context is set up' : 'Pulled the latest team context');
    return done(r);
  }
  if (op === 'view-fix') { api.setPane('doc', 'team:issue:' + el.dataset.issue); return; }
  if (op === 'dismiss-banner') { teamBanner[pid] = null; renderTeamBanner(); return; }
  if (op === 'apply-fix') {
    const ev = teamBanner[pid]; const c = ev && ev.cards[0]; if (!c) return;
    teamBanner[pid] = null; renderTeamBanner();
    toggleGem(true);
    api.agentAsk(pid, `My command \`${ev.command}\` failed with an error ${c.by} already fixed ("${c.title}"). Their cause: ${c.cause || 'not written'}. Their fix: ${c.fix || 'not written'}${c.files.length ? ` (files: ${c.files.join(', ')})` : ''}. Apply the same fix here, then run the command again.`, null, {});
    return;
  }
  if (op === 'import-style') { const r = await api.teamImportStyle(pid, el.dataset.person); toast(r.error || `Answers now lean towards this teammate's style (${r.added} rule${r.added === 1 ? '' : 's'} borrowed). You can undo it.`); return refreshTeam(pid); }
  if (op === 'undo-style') { const r = await api.teamUndoStyle(pid); toast(r.error || 'Your own answer style is back'); return refreshTeam(pid); }
  const a = { phaseId: el.dataset.phaseId, taskId: el.dataset.taskId };
  if (op === 'handoff') a.to = el.parentElement.querySelector('[data-teamsel="handoff"]').value;
  if (op === 'assign') a.to = el.parentElement.querySelector(`[data-teamsel="assign-${a.taskId}"]`).value;
  const r = await api.teamAction(pid, op, a);
  if (r.error) toast(r.rejected ? `Not allowed: ${r.error}` : r.error);
  done(r.error ? null : r);
}
