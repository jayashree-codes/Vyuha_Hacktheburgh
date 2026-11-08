// Behaviour learning, UI side (loaded after app.js and uses its helpers).
// 1. Collector: measures HOW a prompt was typed and how the last reply was read. Only counts and
//    timings leave this file, never keystrokes or text.
// 2. The style chip next to each chat box: shows how Vyuha plans to answer, lets you pick another style.
// 3. The "How Vyuha sees you" page.

const BH = {
  comp: new Map(),        // textarea id → typing measurements for the prompt being written
  reply: null,            // { at, words } when the last reply finished
  read: { scrollUps: 0, scrollPx: 0, mouse: 0 },
  wasRunning: {},         // pid → was Gemini working at the last render
  override: {},           // pid → style picked for the next message (one message only)
  preview: {},            // form id → last preview
  menuFor: null,
  timer: null,
  summary: null
};
const BH_STYLES = [
  { id: '', name: 'Auto', note: 'Vyuha picks from how you’re working' },
  { id: 'overview', name: 'Overview', note: 'a few bullet ideas, short' },
  { id: 'stepwise', name: 'Step by step', note: 'numbered walkthrough, medium' },
  { id: 'deep', name: 'Full detail', note: 'complete code, edge cases' },
  { id: 'clarify', name: 'Ask first', note: 'check what you mean, then answer' }
];
const BH_NAME = Object.fromEntries(BH_STYLES.map(s => [s.id, s.name]));
const isChatInput = el => el && (el.id === 'mainInput' || el.id === 'gemInput');

/* ---------- 1. collector ---------- */
document.addEventListener('keydown', e => {
  if (!isChatInput(e.target) || e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) return;   // sending, not typing
  const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey;
  const del = e.key === 'Backspace' || e.key === 'Delete';
  if (!printable && !del) return;
  const now = performance.now();
  let c = BH.comp.get(e.target.id);
  if (!c) { c = { start: now, last: now, keys: 0, backspaces: 0, pauses: 0, activeMs: 0, pasted: 0, firstKeyAt: Date.now() }; BH.comp.set(e.target.id, c); }
  const gap = now - c.last;
  if (c.keys) { if (gap > 2000) c.pauses++; else c.activeMs += gap; }
  c.last = now;
  c.keys++;
  if (del) c.backspaces++;
}, true);
document.addEventListener('paste', e => {
  if (!isChatInput(e.target)) return;
  const n = ((e.clipboardData && e.clipboardData.getData('text')) || '').length;
  let c = BH.comp.get(e.target.id);
  if (!c) { const now = performance.now(); c = { start: now, last: now, keys: 0, backspaces: 0, pauses: 0, activeMs: 0, pasted: 0, firstKeyAt: Date.now() }; BH.comp.set(e.target.id, c); }
  c.pasted += n;
}, true);
// reading the reply: scrolling back up and moving the mouse over the chat suggest it was actually read
document.addEventListener('wheel', e => {
  if (!e.target.closest || !e.target.closest('.chatlog') || !BH.reply) return;
  BH.read.scrollPx += Math.abs(e.deltaY);
  if (e.deltaY < 0) BH.read.scrollUps++;
}, { passive: true, capture: true });
let bhMouseT = 0;
document.addEventListener('mousemove', e => {
  if (!BH.reply || !e.target.closest || !e.target.closest('.chatlog')) return;
  const now = performance.now(); if (now - bhMouseT < 250) return; bhMouseT = now;
  BH.read.mouse++;
}, { passive: true, capture: true });
// acting on the reply: copying code, opening a source it found
document.addEventListener('click', e => {
  const pid = P && P.id; if (!pid || !e.target.closest) return;
  if (e.target.closest('.chatlog [data-copy]')) api.behaviourNote(pid, 'copied');
  else if (e.target.closest('.chatlog [data-url]')) api.behaviourNote(pid, 'opened');
}, true);
document.addEventListener('copy', e => {
  const pid = P && P.id;
  if (pid && e.target.closest && e.target.closest('.chatlog') && String(getSelection()).length > 20) api.behaviourNote(pid, 'copied');
}, true);

// Called by renderChat: notices when a reply has just finished.
function bhOnChat(pid, c) {
  const was = BH.wasRunning[pid];
  BH.wasRunning[pid] = c.running;
  if (was && !c.running) {
    const last = [...c.transcript].reverse().find(m => m.role === 'agent');
    BH.reply = { at: Date.now(), words: last && last.text ? last.text.split(/\s+/).length : 0 };
    BH.read = { scrollUps: 0, scrollPx: 0, mouse: 0 };
  }
}
function bhTyping(id) {
  const c = BH.comp.get(id);
  if (!c) return {};
  return { keys: c.keys, backspaces: c.backspaces, pauses: c.pauses, activeMs: Math.round(c.activeMs), composeMs: Math.round(c.last - c.start), pasted: c.pasted };
}
// Everything sent with a prompt. Resets the measurements for the next one.
function bhTake(id, text) {
  const typing = bhTyping(id);
  if (typing.pasted !== undefined) typing.pasteRatio = text.length ? Math.min(1, typing.pasted / text.length) : 0;
  const c = BH.comp.get(id);
  let reading = null;
  if (BH.reply) {
    const readMs = Math.max(0, (c ? c.firstKeyAt : Date.now()) - BH.reply.at);
    // most people read about 4 words a second and skim at about 15; faster than that wasn't read
    reading = { readMs, words: BH.reply.words, skimmed: BH.reply.words > 120 && readMs < (BH.reply.words / 15) * 1000 && !BH.read.scrollUps, ...BH.read };
  }
  BH.comp.delete(id);
  BH.reply = null;
  const pid = P && P.id;
  const style = pid ? BH.override[pid] || null : null;
  if (pid) delete BH.override[pid];
  return { typing, reading, style };
}

/* ---------- 2. the style chip ---------- */
const chipHTML = form => `<div class="schipwrap"><button type="button" class="schip" data-act="style-menu" data-form="${form}" aria-haspopup="menu" title="How Gemini will answer. Click to choose.">
  <span class="sdot"></span><span class="slabel">Auto</span>${ICON.chev}</button></div>`;
function bhSchedulePreview(input) {
  clearTimeout(BH.timer);
  BH.timer = setTimeout(() => bhRefreshChip(input.form), 350);
}
async function bhRefreshChip(form) {
  if (!form || !P) return;
  const input = form.querySelector('textarea');
  const chip = form.querySelector('.schip');
  if (!chip) return;
  const override = BH.override[P.id] || null;
  const text = input.value.trim();
  if (!text && !override) { bhSetChip(chip, null); return; }
  const d = text ? await api.behaviourPreview(P.id, text, bhTyping(input.id), override) : { source: 'you', style: override, label: `You chose · ${BH_NAME[override]}` };
  BH.preview[form.id] = d;
  bhSetChip(chip, d);
}
function bhSetChip(chip, d) {
  const label = chip.querySelector('.slabel');
  chip.classList.remove('auto', 'you', 'none');
  if (!d) { label.textContent = 'Auto'; chip.title = 'How Gemini will answer. Vyuha picks a style from how you’re working; click to choose one yourself.'; return; }
  if (d.source === 'you') { chip.classList.add('you'); label.textContent = `You: ${BH_NAME[d.style]}`; chip.title = 'You picked this style for the next message. Click to change.'; return; }
  if (d.source === 'off') { chip.classList.add('none'); label.textContent = 'Adapting off'; return; }
  chip.classList.add(d.style ? 'auto' : 'none');
  label.textContent = d.label;
  const pct = Math.round((d.confidence || 0) * 100);
  chip.title = (d.style ? `Vyuha will ask Gemini for: ${BH_NAME[d.style]} (${pct}% sure${d.source === 'pattern' ? ', from your pattern' : ''}).` : `Not sure enough (${pct}%), so Gemini answers normally.`)
    + (d.matched && d.matched.length ? `\nMatches: ${d.matched.map(m => m.text).join(' / ')}` : '') + '\nClick to choose yourself.';
}
function bhOpenMenu(btn) {
  bhCloseMenu();
  const wrap = btn.parentElement;
  const cur = (P && BH.override[P.id]) || '';
  const m = document.createElement('div');
  m.className = 'smenu'; m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="smh">Answer style for your next message</div>${BH_STYLES.map(s => `<button type="button" role="menuitemradio" aria-checked="${s.id === cur}" data-pick-style="${s.id}" class="${s.id === cur ? 'on' : ''}"><b>${esc(s.name)}</b><small>${esc(s.note)}</small></button>`).join('')}
    <hr><button type="button" data-act="behaviour-page"><b>How Vyuha sees you…</b></button>`;
  wrap.appendChild(m);
  BH.menuFor = btn.dataset.form;
  btn.setAttribute('aria-expanded', 'true');
  const first = m.querySelector('[aria-checked="true"]') || m.querySelector('button'); if (first) first.focus();
}
function bhCloseMenu() {
  document.querySelectorAll('.smenu').forEach(m => m.remove());
  document.querySelectorAll('.schip[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  BH.menuFor = null;
}
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  const pick = e.target.closest('[data-pick-style]');
  if (pick && P) {
    const s = pick.dataset.pickStyle;
    if (s) BH.override[P.id] = s; else delete BH.override[P.id];
    const form = pick.closest('form'); bhCloseMenu(); bhRefreshChip(form);
    const i = form && form.querySelector('textarea'); if (i) i.focus();
    return;
  }
  const chip = e.target.closest('.schip');
  if (chip) { if (BH.menuFor === chip.dataset.form) bhCloseMenu(); else bhOpenMenu(chip); return; }
  if (BH.menuFor && !e.target.closest('.smenu')) bhCloseMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && BH.menuFor) { bhCloseMenu(); e.stopPropagation(); } }, true);
document.addEventListener('input', e => { if (isChatInput(e.target)) bhSchedulePreview(e.target); });

// the small line under each answer that says which style was used
function bhStyleTag(m) {
  const s = m.style;
  if (!s || m.pending) return '';
  const pct = Math.round((s.confidence || 0) * 100);
  const how = { you: 'you chose', auto: `chosen by Vyuha, ${pct}% sure`, pattern: 'from your pattern', explore: 'Vyuha is trying this style to learn what suits you',
                holdout: 'normal answer, kept as a comparison sample', unsure: `normal answer, Vyuha was only ${pct}% sure`, off: 'adapting off' }[s.source] || s.source;
  const name = s.style ? BH_NAME[s.style] : 'Normal';
  if (s.from) return `<button type="button" class="stag" data-act="behaviour-page" title="${esc('Matched: ' + (s.matched || []).join(' / '))}">${ICON.spark}<span>${esc(name)} · from ${esc(s.from)}’s pattern</span></button>`;
  return `<button type="button" class="stag" data-act="behaviour-page" title="${esc((s.matched || []).length ? 'Matched: ' + s.matched.join(' / ') : 'See how Vyuha learns your style')}">${ICON.spark}<span>${esc(name)} · ${esc(how)}</span></button>`;
}

/* ---------- 3. "How Vyuha sees you" ---------- */
const BH_SITUATIONS = [
  { id: 'vague', label: 'my prompt is vague (less specific than usual)', when: [{ feature: 'specificity_z', op: '<', value: -0.5 }] },
  { id: 'detailed', label: 'my prompt is detailed (more specific than usual)', when: [{ feature: 'specificity_z', op: '>', value: 1 }] },
  { id: 'short', label: 'my prompt is shorter than usual', when: [{ feature: 'words_z', op: '<', value: -0.5 }] },
  { id: 'long', label: 'my prompt is longer than usual', when: [{ feature: 'words_z', op: '>', value: 1 }] },
  { id: 'rephrase', label: 'I rephrase my last question', when: [{ feature: 'rephrase', op: '=', value: 1 }] },
  { id: 'bad', label: 'the last answer didn’t work for me', when: [{ feature: 'after_bad_answer', op: '=', value: 1 }] },
  { id: 'early', label: 'the project is in an early phase', when: [{ feature: 'early_phase', op: '=', value: 1 }] },
  { id: 'build', label: 'I’m in Build with me mode', when: [{ feature: 'build_mode', op: '=', value: 1 }] },
  { id: 'late', label: 'it’s late at night', when: [{ feature: 'late_night', op: '=', value: 1 }] },
  { id: 'longsession', label: 'I’ve been working for over 90 minutes', when: [{ feature: 'long_session', op: '=', value: 1 }] },
  { id: 'fast', label: 'I’m typing faster than usual', when: [{ feature: 'typing_speed_z', op: '>', value: 1 }] },
  { id: 'slow', label: 'I’m typing slower than usual', when: [{ feature: 'typing_speed_z', op: '<', value: -0.5 }] },
  { id: 'hesitant', label: 'I pause a lot while typing', when: [{ feature: 'pauses_z', op: '>', value: 1 }] },
  { id: 'open', label: 'I ask an open question (what, why, ideas)', when: [{ feature: 'open_question', op: '=', value: 1 }] },
  { id: 'do', label: 'I ask you to do something (write, fix, build)', when: [{ feature: 'do_request', op: '=', value: 1 }] }
];
const BH_STATUS = { stated: ['Your rule', 'st-you'], testing: ['Testing', 'st-test'], promoted: ['Confirmed', 'st-ok'], retired: ['Retired', 'st-off'] };
const pct = v => (v == null ? '–' : Math.round(v * 100) + '%');
function bhBar(label, v, lo, hi) {
  const x = Math.round(((v || 0) + 1) * 50);
  return `<div class="bbar"><span class="bl">${lo}</span><div class="btrack" role="img" aria-label="${label}: ${x} out of 100"><i style="left:${x}%"></i></div><span class="bl">${hi}</span></div>`;
}
async function behaviourDialog() {
  const b = BH.summary = await api.behaviourSummary();
  const last = b.last || {};
  const st = last.state;
  const base = b.baselines;
  const own = base.words.own;
  const hyp = b.hypotheses.map(h => {
    const [sl, sc] = h.contradicted ? ['Contradicted', 'st-bad'] : BH_STATUS[h.status] || [h.status, ''];
    const n = h.support + h.against;
    return `<li class="hyp ${h.enabled ? '' : 'off'}">
      <div class="hyt"><span class="badge ${sc}">${sl}</span><span>${esc(h.text)}</span></div>
      <div class="hym">→ ${esc(BH_NAME[h.style] || h.style)} · ${n ? `${h.support} for, ${h.against} against` : 'no evidence yet'}${h.source === 'analyst' ? ' · suggested by the analyst' : h.source === 'vyuha' ? ' · Vyuha default' : ''}${h.why ? ` · ${esc(h.why)}` : ''}
        <span class="sp"></span><button type="button" class="mini" data-bh-toggle="${esc(h.id)}">${h.enabled ? 'Switch off' : 'Switch on'}</button><button type="button" class="mini" data-bh-delete="${esc(h.id)}">Delete</button></div>
    </li>`;
  }).join('');
  const reward = b.nHoldout >= 10 && b.nAdaptive >= 10
    ? `Replies Vyuha styled worked <b>${pct(b.rewardAdaptive)}</b> of the time vs <b>${pct(b.rewardHoldout)}</b> for unstyled comparison replies (${b.nAdaptive} vs ${b.nHoldout}).`
    : `Needs about 10 unstyled comparison replies before it can say whether styling helps (has ${b.nHoldout}).`;
  openDialog(`<div class="bhpage"><h2>How Vyuha sees you</h2>
    <p class="sub">Learned from <b>${b.messages}</b> messages. Only numbers are stored (word counts, typing speed, what you did with each reply), never what you type. Everything stays on this computer.</p>

    <h3 class="sech">Right now</h3>
    ${st ? `<p class="bhnow"><b>${esc(st.label)}</b>${last.style ? ` → last answer: ${esc(BH_NAME[last.style])}` : ''}${last.reward != null ? ` · it worked ${pct(last.reward)}` : ''}</p>
      ${bhBar('Clarity', st.clarity, 'exploring', 'clear')}${bhBar('Energy', st.energy, 'low', 'focused')}${bhBar('Satisfaction', st.satisfaction, 'missed', 'working')}`
      : '<p class="sub">Send a message in a project and Vyuha starts learning.</p>'}

    <h3 class="sech">Your normal${own ? '' : ' <small>(typical defaults until you’ve sent 10 messages)</small>'}</h3>
    <div class="bhgrid">
      <div><b>${Math.round(base.words.median)}</b><small>words per prompt</small></div>
      <div><b>${base.specificity.median}</b><small>specific terms per prompt</small></div>
      <div><b>${base.typing_speed.median}</b><small>keys per second</small></div>
      <div><b>${base.pauses.median}</b><small>pauses over 2 s</small></div>
      <div><b>${pct(base.backspace.median)}</b><small>of keys are corrections</small></div>
    </div>
    <p class="sub">Every new prompt is compared with these, so “short” or “detailed” means short or detailed <i>for you</i>.</p>

    <h3 class="sech">Your patterns</h3>
    <p class="sub">Your rules are used straight away. Others are tested first and used once the evidence holds up (15+ cases, 75% agreement).</p>
    <ul class="hyps">${hyp || '<li class="sub">No patterns yet.</li>'}</ul>
    <form id="bhAddForm" class="bhadd">
      <span>When</span><select id="bhWhen" aria-label="Situation">${BH_SITUATIONS.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('')}</select>
      <span>answer with</span><select id="bhStyle" aria-label="Style">${BH_STYLES.slice(1).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <button class="btn">Add rule</button>
    </form>

    <h3 class="sech">Is it working?</h3>
    <ul class="bhstats">
      <li>You kept Vyuha’s choice <b>${pct(b.agreement)}</b> of the time (changing it with the chip teaches it the most).</li>
      <li>${reward}</li>
      <li>${b.rephraseRecent == null ? 'Rephrase rate: not enough messages yet.' : `You rephrased <b>${pct(b.rephraseRecent)}</b> of recent questions${b.rephraseEarlier != null ? ` (earlier: ${pct(b.rephraseEarlier)})` : ''}. Lower is better.`}</li>
      <li>What each style has learned from: ${b.styles.map(s => `${esc(s.name)} ${s.learned}`).join(', ')} replies.</li>
    </ul>

    <h3 class="sech">Analyst</h3>
    <p class="sub">${b.analysis ? `Last run ${esc(new Date(b.analysis.at).toLocaleString())}: ${esc(b.analysis.notes || 'no notes')}${b.analysis.added ? ` Added ${b.analysis.added} pattern${b.analysis.added > 1 ? 's' : ''} to test.` : ''}` : 'Gemini looks at the numbers every 50 messages (or weekly) and suggests patterns to test. It only sees totals, never your messages.'} ${b.sinceAnalysis} messages since the last run.</p>
    <div class="keyrow"><button type="button" class="btn" data-act="bh-analyse">Run analysis now</button><span class="keymsg" id="bhMsg"></span></div>

    <h3 class="sech">Controls</h3>
    <label class="toggle"><input type="checkbox" id="bhCollect" ${b.settings.collect ? 'checked' : ''}><span>Learn from how I work<small>Measure typing, prompt detail and reactions to replies.</small></span></label>
    <label class="toggle"><input type="checkbox" id="bhAdapt" ${b.settings.adapt ? 'checked' : ''}><span>Adapt Gemini’s answers<small>Off: keep learning, but Gemini always answers normally.</small></span></label>
    <div class="mactions"><button type="button" class="btn" data-act="bh-reveal">Show files</button><button type="button" class="btn danger" data-act="bh-reset">Delete everything learned</button><span class="sp"></span><button type="button" class="btn primary" data-act="close-dialog">Done</button></div>
  </div>`);
}
async function bhEdit(op, a) {
  const r = await api.behaviourEdit(op, a);
  if (r && r.error) { toast(r.error); return; }
  const scroll = $('#modal').scrollTop;
  await behaviourDialog();
  $('#modal').scrollTop = scroll;
}
document.addEventListener('click', async e => {
  if (!e.target.closest) return;
  const el = e.target.closest('button'); if (!el) return;
  if (el.dataset.act === 'behaviour-page') { bhCloseMenu(); behaviourDialog(); return; }
  if (el.dataset.bhToggle) return bhEdit('toggle', { id: el.dataset.bhToggle });
  if (el.dataset.bhDelete) return bhEdit('delete', { id: el.dataset.bhDelete });
  if (el.dataset.act === 'bh-reveal') { api.behaviourReveal(); return; }
  if (el.dataset.act === 'bh-reset') {
    if (el.dataset.confirm) return bhEdit('reset');
    el.dataset.confirm = '1'; el.textContent = 'Click again to delete everything'; return;
  }
  if (el.dataset.act === 'bh-analyse') {
    const msg = $('#bhMsg'); el.disabled = true; if (msg) { msg.className = 'keymsg'; msg.textContent = 'Asking Gemini…'; }
    const r = await api.behaviourAnalyse();
    if (r && r.error) { el.disabled = false; if (msg) { msg.className = 'keymsg bad'; msg.textContent = r.error; } return; }
    await behaviourDialog();
    toast(r.added ? `Analyst suggested ${r.added} new pattern${r.added > 1 ? 's' : ''} to test` : 'Analyst found nothing new to test yet');
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'bhCollect') bhEdit('settings', { collect: e.target.checked });
  if (e.target.id === 'bhAdapt') bhEdit('settings', { adapt: e.target.checked });
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'bhAddForm') return;
  e.preventDefault(); e.stopImmediatePropagation();
  const sit = BH_SITUATIONS.find(s => s.id === $('#bhWhen').value);
  const style = $('#bhStyle').value;
  bhEdit('add', { when: sit.when, style, text: `When ${sit.label}, answer with ${BH_NAME[style].toLowerCase()}.` });
}, true);
