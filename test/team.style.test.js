// Sharing answer styles between teammates. Run: node test/team.style.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Behaviour, PRIOR_PRECISION, X_NAMES, SHARED_X } = require('../src/behaviour');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
let t = Date.parse('2026-11-08T14:00:00');
const now = () => t;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-style-'));

// Priya: in Build mode she always wants step by step, and says so in a rule
function trainPriya(b) {
  b.p.settings.holdout = 0;
  for (let i = 0; i < 10; i++) {
    b.begin('p', i % 2 ? 'next step?' : 'add the session check', { override: 'stepwise', context: { mode: 'build' } });
    t += 3 * 60e3; b.finish('p', {}); t += 60e3;
  }
  b.edit('add', { when: [{ feature: 'build_mode', op: '=', value: 1 }, { feature: 'open_question', op: '=', value: 0 }], style: 'stepwise', text: 'When I am building, walk me through it step by step.' });
}

const priya = new Behaviour(tmp(), { now, random: rng(1) });
trainPriya(priya);
const style = priya.exportStyle();
ok(Array.isArray(style.features) && style.arms.stepwise.n >= 10 && style.styleMix.stepwise >= 10, 'exportStyle: weights, counts and style mix');
ok(!('history' in style) && !('stats' in style) && !('settings' in style) && !('last' in style), 'exportStyle never includes history, stats, settings or the last interaction');
ok(!/typing_speed|pauses_z|backspace_z/.test(JSON.stringify(style)) && style.features.length === X_NAMES.length - 3 && style.arms.deep.m.length === style.features.length,
   `exportStyle has no typing_speed_z, pauses_z or backspace_z (names, weights or rules): ${style.features.length} of ${X_NAMES.length} features`);
ok(style.hypotheses.some(h => /step by step/.test(h.text)) && style.hypotheses.every(h => ['stated', 'promoted', 'testing'].includes(h.status)), 'exportStyle includes only active rules');

const ravi = new Behaviour(tmp(), { now, random: rng(2) });
ravi.p.settings.holdout = 0;
for (let i = 0; i < 12; i++) { ravi.begin('p', 'what about caching ' + i, { typing: { keys: 20 + i, activeMs: 5000 }, context: { mode: 'teach' } }); t += 60e3; ravi.finish('p', {}); }
const before = ravi.preview('p', 'add the login form', {}, { mode: 'build' });
const historyBefore = JSON.stringify(ravi.p.history);
const fileBefore = fs.readFileSync(ravi.file, 'utf8');
const mBefore = JSON.parse(JSON.stringify(ravi.p.bandit));

const r = ravi.importStyle(style, 'Priya');
ok(r.added >= 1, `importStyle adds Priya's rules (${r.added})`);
ok(JSON.stringify(ravi.p.history) === historyBefore, 'Ravi’s history (his own baselines) is byte for byte unchanged');
const blendOk = ['overview', 'stepwise', 'deep', 'clarify'].every(a => X_NAMES.every((n, i) => {
  const j = SHARED_X.indexOf(n);
  return j < 0 ? ravi.p.bandit[a].m[i] === mBefore[a].m[i] && ravi.p.bandit[a].q[i] === mBefore[a].q[i]
               : Math.abs(ravi.p.bandit[a].m[i] - (0.5 * mBefore[a].m[i] + 0.5 * style.arms[a].m[j])) < 1e-12;
}));
ok(blendOk, 'shared weights: m = 0.5 × mine + 0.5 × theirs; my own typing weights (m and q) keep their values');
ok(['overview', 'stepwise', 'deep', 'clarify'].every(a => SHARED_X.every(n => { const i = X_NAMES.indexOf(n); return ravi.p.bandit[a].q[i] === Math.max(PRIOR_PRECISION, mBefore[a].q[i] * 0.5); })),
   'q = max(prior, mine × 0.5) for shared weights, so new evidence moves it');
{
  const typist = new Behaviour(tmp(), { now, random: rng(9) });
  typist.edit('add', { when: [{ feature: 'typing_speed_z', op: '>', value: 1 }], style: 'deep', text: 'When I type fast, go deep.' });
  const probe = new Behaviour(tmp(), { now, random: rng(10) });
  const res = probe.importStyle({ ...style, hypotheses: [{ text: 'x', style: 'deep', status: 'stated', when: [{ feature: 'pauses_z', op: '>', value: 1 }] }] }, 'Mallory');
  ok(!typist.exportStyle().hypotheses.some(h => /type fast/.test(h.text)) && res.added === 0, 'rules that use typing features are neither exported nor imported');
}
const borrowed = ravi.p.hypotheses.filter(h => h.status === 'borrowed');
ok(borrowed.length >= 1 && borrowed.every(h => h.from === 'Priya' && h.source === 'teammate' && h.support === 0 && h.against === 0), 'Priya’s rules are borrowed, from Priya, with fresh evidence counts');
ok(ravi.importStyle(style, 'Priya').added === 0, 'importing again adds no duplicate rules');
ravi.undoImport();   // undo the second import (it restores the state just before it)
// (state is now the first import again)

const after = ravi.preview('p', 'add the login form', {}, { mode: 'build' });
const m = after.matched.find(x => x.from === 'Priya');
console.log(`    before: ${before.style} (${before.source}, ${before.confidence}); after: ${after.style} (${after.source}, ${after.confidence})`);
ok(m && after.style === 'stepwise', `a Build-mode prompt matching Priya's rule now gets her style (${before.style} → ${after.style})`);

// undo restores profile.json exactly
const r2 = new Behaviour(tmp(), { now, random: rng(3) });
r2.save();
const orig = fs.readFileSync(r2.file, 'utf8');
r2.importStyle(style, 'Priya');
ok(fs.readFileSync(r2.file, 'utf8') !== orig && r2.canUndoImport(), 'import changes profile.json and keeps a backup');
r2.undoImport();
ok(fs.readFileSync(r2.file, 'utf8') === orig && !r2.canUndoImport() && !r2.p.hypotheses.some(h => h.status === 'borrowed'), 'undo restores profile.json exactly');

// a style from a different feature set is rejected
let err = null;
try { r2.importStyle({ ...style, features: [...style.features, 'heart_rate'] }, 'Mallory'); } catch (e) { err = e; }
ok(err && /features/.test(err.message) && fs.readFileSync(r2.file, 'utf8') === orig, 'a style with different features is rejected and nothing changes');

// borrowed rules that keep failing are retired like testing ones
{
  const b = new Behaviour(tmp(), { now, random: rng(4) });
  b.p.settings.holdout = 0;
  b.importStyle(style, 'Priya');
  const h = b.p.hypotheses.find(x => x.status === 'borrowed');
  for (let i = 0; i < 16; i++) {
    b.begin('p', 'add the login form ' + i, { override: 'deep', context: { mode: 'build' } });
    t += 2 * 60e3; b.finish('p', {}); t += 40 * 60e3;
  }
  ok(h.status === 'retired', `a borrowed rule contradicted 15+ times is retired (${h.support} for, ${h.against} against)`);
}
console.log('all team style checks passed');
