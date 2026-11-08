// Behaviour engine checks. Run: node test/behaviour.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Behaviour, textFeatures, similarity, STYLES } = require('../src/behaviour');
const agent = require('../src/agent');

let t = Date.parse('2026-11-08T14:00:00');
const now = () => t;
// seeded random numbers so runs are repeatable
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-bh-'));
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };

/* prompt features */
const vague = textFeatures('spam classifier ideas?');
const detailed = textFeatures('Write train.py with TF-IDF + logistic regression, stratified 80/20 split, report per-class F1');
ok(vague.words === 3 && vague.open_question === 1, 'vague prompt: 3 words, open question');
ok(detailed.specificity >= 8 && detailed.do_request === 1, `detailed prompt: specificity ${detailed.specificity}, a request to do something`);
ok(similarity('how do I split my dataset for training', 'how should I split the dataset for training?') > 0.45, 'a rephrase is detected as similar');
ok(similarity('explain tf-idf', 'deploy the model to docker') === 0, 'unrelated prompts are not similar');

/* robust z-score against the user's own normal (worked example: median 22 words, MAD 9 → 3 words is about -1.43) */
{
  const b = new Behaviour(tmp(), { now });
  b.p.history.specificity = Array.from({ length: 50 }, (_, i) => [0, 1, 1, 2, 2, 2, 3, 3][i % 8]);
  const base = b.baseline('specificity');
  ok(base.own && base.median === 2, `baseline uses the user's own median once there are 10+ messages (median ${base.median})`);
  const z = b.z('specificity', 6);
  ok(z > 2, `6 specific terms is unusual for this user (z=${z.toFixed(2)})`);
}

/* the first decisions follow what the user said about herself */
{
  t = Date.parse('2026-11-08T14:00:00');
  const b = new Behaviour(tmp(), { now, random: rng(1) });
  b.p.settings.holdout = 0;
  const d1 = b.begin('p', 'spam classifier ideas?', { typing: { keys: 22, activeMs: 6000, pauses: 3, backspaces: 2 }, context: { earlyPhase: true, mode: 'teach' } });
  ok(d1.style === 'overview' && d1.directive.includes('overview'), `vague prompt early on → ${d1.style} (${d1.label})`);
  ok(/never the substance/.test(d1.directive), 'the style instruction never lets Gemini soften the substance');
  t += 120e3; b.note('p', 'copied');
  const d2 = b.begin('p', detailed.words && 'Write train.py with TF-IDF + logistic regression, stratified 80/20 split, report per-class F1',
                     { typing: { keys: 95, activeMs: 18000, pauses: 0, backspaces: 4 }, context: { mode: 'build' } });
  ok(d2.style === 'deep', `detailed request in Build mode → ${d2.style} (${d2.label})`);
  const log = fs.readFileSync(b.log, 'utf8');
  ok(!/spam|classifier|train\.py/i.test(log) && !/spam|train\.py/i.test(fs.readFileSync(b.file, 'utf8')), 'no prompt text is ever written to disk');
  t += 60e3;
  const d3 = b.begin('p', 'no, that’s not what I meant, write train.py with tf-idf and logistic regression and a stratified split',
                     { typing: { keys: 90, activeMs: 9000, pauses: 0, backspaces: 18 }, context: { mode: 'build' } });
  ok(b.p.last.reward === 0 || d3.state.satisfaction <= -0.6, `a rephrase straight after scores the last reply as a miss (reward ${b.p.last.reward})`);
  ok(d3.style !== 'deep', `after "Full detail" missed, it doesn't try full detail again straight away (${d3.source}: ${d3.style})`);
  ok(d3.directive.includes('may not have been what the user wanted'), 'after a miss, Gemini is told not to repeat the last reply');
  ok(d3.state.label === 'Last answer missed', `state after a rephrase: ${d3.state.label}`);
}

/* learns a user who is NOT like the defaults: this person wants full detail even for short, vague prompts */
{
  t = Date.parse('2026-11-09T10:00:00');
  const b = new Behaviour(tmp(), { now, random: rng(7) });
  b.p.settings.holdout = 0;
  const before = b.preview('p', 'ideas for a recommender?', {}, { earlyPhase: true, mode: 'teach' });
  for (let i = 0; i < 60; i++) {
    const d = b.begin('p', i % 2 ? 'ideas for a recommender?' : 'any thoughts on caching?', { typing: { keys: 25, activeMs: 6000, pauses: 2, backspaces: 1 }, context: { earlyPhase: true, mode: 'teach' } });
    // the simulated user: copies and runs things after detailed answers, asks for more after short ones
    t += 4 * 60e3;
    if (d.style === 'deep') { b.note('p', 'copied'); b.note('p', 'approved'); }
    const next = d.style === 'deep' ? 'thanks, next question' : 'more detail please, show full code';
    b.finish('p', { next, nextFeat: b.features('p', next, {}, {}) });
    t += 60e3;
  }
  const after = b.preview('p', 'ideas for a recommender?', {}, { earlyPhase: true, mode: 'teach' });
  ok(before.style === 'overview' && after.style === 'deep', `learned this user's own pattern: vague prompt ${before.style} → ${after.style} after 60 messages`);
}

/* the user's own choice from the chip is a strong label */
{
  t = Date.parse('2026-11-10T10:00:00');
  const b = new Behaviour(tmp(), { now, random: rng(3) });
  b.p.settings.holdout = 0;
  for (let i = 0; i < 6; i++) {
    b.begin('p', 'what about embeddings?', { override: 'stepwise', context: { mode: 'teach' } });
    t += 3 * 60e3; b.finish('p', {}); t += 60e3;
  }
  const d = b.preview('p', 'what about embeddings?', {}, { mode: 'teach' });
  ok(d.style === 'stepwise', `six manual picks of "Step by step" teach it (now suggests ${d.style})`);
  ok(b.summary().agreement === 0, 'agreement rate counts overrides');
}

/* hypotheses: promotion, user rules, analyst suggestions */
{
  t = Date.parse('2026-11-11T10:00:00');
  const b = new Behaviour(tmp(), { now, random: rng(5) });
  const h = b.p.hypotheses.find(x => x.id === 'h-rephrase');
  ok(h.status === 'testing', 'Vyuha’s own default pattern starts as "testing"');
  for (let i = 0; i < 16; i++) {
    b.begin('p', 'how do I split my dataset for training', { context: { mode: 'teach' } });
    t += 60e3;
    b.begin('p', 'how should I split the dataset for training?', { override: 'clarify', context: { mode: 'teach' } });
    t += 2 * 60e3;
    b.finish('p', {}); t += 40 * 60e3;
  }
  ok(h.status === 'promoted', `with 15+ supporting cases the pattern is promoted (${h.support} for, ${h.against} against)`);
  const s = b.edit('add', { when: [{ feature: 'late_night', op: '=', value: 1 }], style: 'overview', text: 'Late at night, keep it short.' });
  ok(s.hypotheses.some(x => x.text === 'Late at night, keep it short.' && x.status === 'stated'), 'user rules apply immediately');
  const added = b.applyAnalysis({ new: [{ text: 'In Build mode I want full detail.', style: 'deep', when: [{ feature: 'build_mode', op: '=', value: 1 }] },
                                        { text: 'bad feature', style: 'deep', when: [{ feature: 'heart_rate', op: '>', value: 1 }] },
                                        { text: 'bad style', style: 'poem', when: [{ feature: 'build_mode', op: '=', value: 1 }] }], notes: 'Thin data.' });
  ok(added === 1, 'analyst suggestions are validated: unknown features and styles are dropped');
  const input = b.analystInput();
  ok(!JSON.stringify(input).match(/split my dataset/), 'the analyst only sees aggregates, never prompts');
  const reset = b.edit('reset');
  ok(reset.messages === 0 && !fs.existsSync(b.log), 'delete everything clears the profile and the log');
}

/* holdout replies (no style) are kept for comparison and never train the bandit */
{
  t = Date.parse('2026-11-12T10:00:00');
  const b = new Behaviour(tmp(), { now, random: rng(11) });
  b.p.settings.holdout = 1;
  const n0 = b.p.bandit.overview.n + b.p.bandit.deep.n + b.p.bandit.stepwise.n + b.p.bandit.clarify.n;
  const d = b.begin('p', 'spam classifier ideas?', { context: { earlyPhase: true } });
  t += 60e3; b.finish('p', {});
  const n1 = b.p.bandit.overview.n + b.p.bandit.deep.n + b.p.bandit.stepwise.n + b.p.bandit.clarify.n;
  ok(d.source === 'holdout' && !d.directive && n1 === n0 && b.summary().nHoldout === 1, 'holdout: normal answer, scored, not trained on');
}

/* the style instruction reaches Gemini's system prompt */
{
  const sp = agent.systemPrompt({ id: 'x', summary: '', phase: '1', phases: ['1'], events: [], decisions: [] }, [], [], 'teach', 'RESPONSE STYLE for this message only');
  ok(sp.trim().endsWith('RESPONSE STYLE for this message only'), 'system prompt ends with the style instruction');
  ok(Object.keys(STYLES).length === 4, 'four answer styles');
}
console.log('all behaviour checks passed');
