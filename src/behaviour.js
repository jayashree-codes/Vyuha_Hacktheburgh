// Behaviour: learns how this user likes to be answered, from how they work.
//
// Fast loop (every message, no API calls):
//   features of the prompt and of how it was typed → compared with the user's own normal (robust z-scores)
//   → a contextual bandit (Thompson sampling) picks an answer style → a style instruction for Gemini.
//   The user's reaction to the reply (copied code, approved a command, rephrased, "shorter please"…)
//   becomes the reward that trains the bandit.
// Slow loop (every ~50 messages): an analyst (Gemini) proposes written hypotheses from aggregate numbers;
//   plain statistics decide whether each hypothesis is promoted or retired.
//
// Privacy: only numbers are stored, never prompt text or keystrokes. Everything stays in userData/behaviour/.
const fs = require('fs');
const path = require('path');

const STYLES = {
  overview: {
    name: 'Overview',
    directive: 'Give a short overview: 4-7 bullet points of ideas or options, one line each, under about 150 words in total. Skip code and deep detail unless asked. End with one short question that helps the user choose a direction.'
  },
  stepwise: {
    name: 'Step by step',
    directive: 'Explain step by step: a short numbered walkthrough with the key reasoning for each step and small examples where useful. Medium length; don’t try to cover every edge case.'
  },
  deep: {
    name: 'Full detail',
    directive: 'Go into full detail: complete, working code where relevant, the reasons behind important choices, and edge cases and pitfalls. Length is fine, but structure it with headings so it is easy to scan.'
  },
  clarify: {
    name: 'Ask first',
    directive: 'Before answering in full, check you have understood: restate in one sentence what you think the user wants, then ask one or two specific questions. Keep the whole reply under about 80 words.'
  }
};
const ARMS = Object.keys(STYLES);

// The numbers that describe one message. z-scored ones are compared with the user's own history.
const Z_FEATURES = ['words', 'specificity', 'typing_speed', 'pauses', 'backspace'];
const FLAGS = ['rephrase', 'early_phase', 'build_mode', 'late_night', 'long_session', 'after_bad_answer', 'open_question', 'do_request'];
const X_NAMES = ['bias', ...Z_FEATURES.map(f => f + '_z'), ...FLAGS];
const FEATURE_NAMES = X_NAMES.slice(1);   // what hypotheses may test
// words are compared on a log scale, so their default is log(1+18 words) with a spread of about ±55%
const DEFAULT_BASE = { words: [Math.log1p(18), 0.55], specificity: [2, 1.5], typing_speed: [4, 1.5], pauses: [1, 1], backspace: [0.08, 0.05] };

// Prior beliefs for each style (mean weight per input). They encode common sense plus what the user said
// about themselves: vague prompts → overview; detailed prompts → full detail. Data then overrides them.
const PRIOR = {
  overview: { specificity_z: -0.8, words_z: -0.5, early_phase: 0.6, open_question: 0.5, do_request: -0.5, build_mode: -0.3 },
  stepwise: { bias: 0.3, open_question: 0.2, build_mode: -0.2 },
  deep:     { specificity_z: 0.9, words_z: 0.4, do_request: 0.6, build_mode: 0.4, early_phase: -0.4, open_question: -0.2 },
  clarify:  { bias: -1.2, rephrase: 1.6, after_bad_answer: 0.8, specificity_z: -0.2 }
};
const PRIOR_PRECISION = 4;
const MAX_STEP = 0.5;   // one reply can't swing a weight by more than this
const EXPLORE = 0.4;    // narrower draws for the actual choice: tries another style roughly 1 time in 10

const SEED_HYPOTHESES = [
  { id: 'h-vague', text: 'When my prompt is vague, I’m still understanding the problem: give an overview.', source: 'you', status: 'stated',
    when: [{ feature: 'specificity_z', op: '<', value: -0.5 }], style: 'overview' },
  { id: 'h-detailed', text: 'When my prompt is detailed, I’m interested and productive: go into full detail.', source: 'you', status: 'stated',
    when: [{ feature: 'specificity_z', op: '>', value: 1 }], style: 'deep' },
  { id: 'h-ideation', text: 'While ideating early in a project, keep answers short and list ideas.', source: 'you', status: 'stated',
    when: [{ feature: 'early_phase', op: '=', value: 1 }, { feature: 'open_question', op: '=', value: 1 }], style: 'overview' },
  { id: 'h-rephrase', text: 'When I rephrase a question, the last answer missed: check what I mean first.', source: 'vyuha', status: 'testing',
    when: [{ feature: 'rephrase', op: '=', value: 1 }], style: 'clarify' }
];

const TECH = /\b(api|model|dataset|data|train(ing)?|test|split|accuracy|precision|recall|f1|loss|epoch|batch|regression|classifier|classification|tokeni[sz]er|embedding|vector|function|class|method|loop|array|list|dict|json|csv|sql|query|docker|kubernetes|deploy|endpoint|server|database|schema|regex|python|javascript|typescript|pandas|numpy|sklearn|scikit|pytorch|torch|tensorflow|keras|transformers?|bert|llm|rag|prompt|pipeline|feature|label|metric|hyperparameters?|learning rate|gradient|optimi[sz]er|cnn|rnn|lstm|attention|tf-?idf|naive bayes|svm|xgboost|cross[- ]validation|stratified|git|commit|branch|npm|pip|conda|flask|fastapi|react|html|css)\b/gi;
const CONSTRAINT = /\b(using|with|must|exactly|only|without|per|each|at least|at most|instead of|return|input|output|error|version|format|step)\b/gi;
const HEDGE = /\b(maybe|some|something|kinda|kind of|sort of|any ideas?|not sure|ideas?|thoughts|perhaps|possible|options?|anything|stuff)\b/gi;
const OPEN_Q = /^\s*(what|why|how (should|would|could|do i|to)|which|any|ideas?|thoughts|explain|help me understand|can you explain|tell me about|where (do|should) i)\b|\b(ideas?|options|approaches|brainstorm|suggest|explain|understand|overview)\b/i;
const DO_REQ = /^\s*(write|create|build|fix|implement|add|run|make|generate|refactor|debug|update|change|convert|train|deploy|set ?up|install|code)\b/i;
const NEG = /^\s*(no\b|nope|wrong|that'?s not|not what|this isn'?t|doesn'?t work|didn'?t work|still (not|doesn'?t|wrong|failing|error)|i (said|meant|mean)\b)/i;
const POS = /^\s*(thanks|thank you|perfect|great|awesome|nice|exactly|that works|it works|got it|makes sense|cool)\b/i;
const WANT_SHORT = /\b(shorter|too long|tl;?dr|too much|be brief|briefly|concise|in short|summari[sz]e)\b/i;
const WANT_MORE = /\b(more detail|elaborate|explain more|in depth|go deeper|expand on|more about|full code|step by step)\b/i;

const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sigmoid = v => 1 / (1 + Math.exp(-v));
const words = t => (String(t).toLowerCase().match(/[a-z0-9][a-z0-9'_.-]*/g) || []);
const STOP = new Set('a an the and or to of in on for is it this that i me my you your can could would should please with be how what do does just about'.split(' '));
function similarity(a, b) {
  const A = new Set(words(a).filter(w => !STOP.has(w))), B = new Set(words(b).filter(w => !STOP.has(w)));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}
function gaussian(rand) { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }

// Features of the prompt text itself. Returns numbers only.
function textFeatures(text) {
  const t = String(text || '');
  const w = words(t).length;
  const codeish = (t.match(/[A-Za-z_]+\.[A-Za-z]{1,5}\b|[a-z]+_[a-z_]+|[a-z]+[A-Z][A-Za-z]+|\w+\(\)/g) || []).length;
  const numbers = (t.match(/\b\d+([.,]\d+)?%?\b|\b\d+\/\d+\b/g) || []).length;
  const listed = (t.match(/^\s*(\d+[.)]|[-*•])\s+/gm) || []).length;
  const fences = (t.match(/```/g) || []).length / 2;
  const specificity = (t.match(TECH) || []).length + codeish + numbers + 0.5 * (t.match(CONSTRAINT) || []).length + listed + 3 * Math.floor(fences);
  return {
    words: w,
    specificity: Math.round(specificity * 10) / 10,
    hedges: (t.match(HEDGE) || []).length,
    open_question: OPEN_Q.test(t) && !DO_REQ.test(t) ? 1 : 0,
    do_request: DO_REQ.test(t) ? 1 : 0
  };
}

class Behaviour {
  constructor(dir, { now = () => Date.now(), random = Math.random } = {}) {
    this.dir = dir;
    this.now = now;
    this.random = random;
    this.file = path.join(dir, 'profile.json');
    this.log = path.join(dir, 'signals.jsonl');
    this.pending = new Map();   // pid → the interaction waiting for its outcome
    this.lastText = new Map();  // pid → previous prompt text (memory only, never written)
    this.session = { start: 0, last: 0 };
    this.p = this.load();
  }

  fresh() {
    const bandit = {};
    for (const a of ARMS) bandit[a] = { m: X_NAMES.map(n => PRIOR[a][n] || 0), q: X_NAMES.map(() => PRIOR_PRECISION), n: 0 };
    return {
      version: 1,
      settings: { collect: true, adapt: true, holdout: 0.1 },
      history: Object.fromEntries(Z_FEATURES.map(f => [f, []])),
      bandit,
      hypotheses: SEED_HYPOTHESES.map(h => ({ ...h, when: h.when.map(c => ({ ...c })), support: 0, against: 0, enabled: true, created: new Date(this.now()).toISOString() })),
      stats: { messages: 0, overrides: 0, decided: 0, rewards: { adaptive: [], holdout: [] }, rephrases: [], sinceAnalysis: 0, lastAnalysis: 0 },
      last: null,
      analysis: null
    };
  }
  load() {
    try {
      const p = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const f = this.fresh();
      // keep stored data, fill in anything newer versions added
      return { ...f, ...p, settings: { ...f.settings, ...p.settings }, stats: { ...f.stats, ...p.stats },
               history: { ...f.history, ...p.history }, bandit: { ...f.bandit, ...p.bandit } };
    } catch (e) { return this.fresh(); }
  }
  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.p, null, 2));
    fs.renameSync(tmp, this.file);
  }
  appendLog(rec) { try { fs.mkdirSync(this.dir, { recursive: true }); fs.appendFileSync(this.log, JSON.stringify(rec) + '\n'); } catch (e) { /* best effort */ } }

  /* ---------- the user's own normal ---------- */
  baseline(f) {
    const h = this.p.history[f] || [];
    if (h.length < 10) return { median: DEFAULT_BASE[f][0], mad: DEFAULT_BASE[f][1], n: h.length, own: false };
    const m = median(h);
    const mad = median(h.map(v => Math.abs(v - m)));
    return { median: m, mad: Math.max(mad, DEFAULT_BASE[f][1] * 0.25), n: h.length, own: true };
  }
  z(f, v) { const b = this.baseline(f); return clip((v - b.median) / (1.4826 * b.mad), -3, 3); }

  /* ---------- one message → features ---------- */
  features(pid, text, typing = {}, ctx = {}) {
    const t = this.now();
    const tf = textFeatures(text);
    const prev = this.lastText.get(pid);
    const pend = this.pending.get(pid);
    const sim = prev ? similarity(prev, text) : 0;
    const quick = pend && t - pend.t < 5 * 60e3;
    const rephrase = prev && quick && (sim >= 0.45 || NEG.test(text)) ? 1 : 0;
    const sessionStart = this.session.last && t - this.session.last < 30 * 60e3 ? this.session.start : t;
    const hour = new Date(t).getHours();
    const activeSec = Math.max(0.5, (typing.activeMs || 0) / 1000);
    const raw = {
      words: tf.words,
      specificity: tf.specificity,
      typing_speed: typing.keys ? clip(typing.keys / activeSec, 0, 20) : null,
      pauses: typing.keys ? typing.pauses || 0 : null,
      backspace: typing.keys ? clip((typing.backspaces || 0) / typing.keys, 0, 1) : null
    };
    const flags = {
      rephrase,
      early_phase: ctx.earlyPhase ? 1 : 0,
      build_mode: ctx.mode === 'build' ? 1 : 0,
      late_night: hour >= 23 || hour < 5 ? 1 : 0,
      long_session: t - sessionStart > 90 * 60e3 ? 1 : 0,
      after_bad_answer: this.p.last && this.p.last.reward != null && this.p.last.reward < 0.4 && t - this.p.last.t < 30 * 60e3 ? 1 : 0,
      open_question: tf.open_question,
      do_request: tf.do_request
    };
    const zs = {};
    for (const f of Z_FEATURES) zs[f + '_z'] = raw[f] == null ? 0 : Math.round(this.z(f, f === 'words' ? Math.log1p(raw[f]) : raw[f]) * 100) / 100;
    // words are compared on a log scale: 5→10 words is as big a jump as 50→100
    const named = { ...zs, ...flags };
    return { raw, hedges: tf.hedges, pasted: typing.pasteRatio || 0, named, x: X_NAMES.map(n => (n === 'bias' ? 1 : named[n])), sim: Math.round(sim * 100) / 100, hour };
  }

  /* ---------- what mode the user seems to be in (for display) ---------- */
  state(feat, lastReward) {
    const n = feat.named;
    const clarity = Math.tanh(0.5 * n.specificity_z + 0.25 * n.words_z + 0.4 * n.do_request - 0.3 * n.open_question - 0.15 * feat.hedges - 0.15 * n.pauses_z);
    const energy = Math.tanh(0.35 * n.typing_speed_z + 0.3 * n.words_z + 0.2 * n.specificity_z - 0.5 * n.late_night - 0.4 * n.long_session);
    let satisfaction = lastReward == null ? 0 : (lastReward - 0.5) * 2;
    if (n.rephrase) satisfaction = Math.min(satisfaction, -0.6);
    const r = v => Math.round(v * 100) / 100;
    let label = 'Steady';
    if (satisfaction < -0.3) label = 'Last answer missed';
    else if (clarity < -0.3) label = 'Exploring';
    else if (clarity > 0.3 && energy > -0.1) label = 'Focused';
    else if (energy < -0.35) label = 'Low energy';
    return { clarity: r(clarity), energy: r(energy), satisfaction: r(satisfaction), label };
  }

  /* ---------- hypotheses ---------- */
  matches(h, named) {
    return h.when.every(c => {
      const v = named[c.feature];
      if (v == null) return false;
      return c.op === '<' ? v < c.value : c.op === '>' ? v > c.value : Math.round(v) === Number(c.value);
    });
  }
  active(h) { return h.enabled && (h.status === 'stated' || h.status === 'promoted'); }

  /* ---------- choosing a style ---------- */
  // sample = 0: the posterior mean; otherwise a random draw with the noise scaled by `sample`
  score(arm, x, sample) {
    const b = this.p.bandit[arm];
    let s = 0;
    for (let i = 0; i < x.length; i++) s += (sample ? b.m[i] + (sample * gaussian(this.random)) / Math.sqrt(b.q[i]) : b.m[i]) * x[i];
    return sigmoid(s);
  }
  // A live preview while the user types: same logic, but no random exploration and nothing recorded.
  preview(pid, text, typing, context, override) {
    if (!this.p.settings.collect) return { style: null, source: 'off', label: 'Off', confidence: 0 };
    const d = this.decide(this.features(pid, text, typing, context), override, { preview: true });
    delete d.directive;
    return d;
  }
  decide(feat, override, { preview = false } = {}) {
    const out = { state: this.state(feat, this.p.last && this.p.last.reward), matched: [] };
    for (const h of this.p.hypotheses) if (this.active(h) && this.matches(h, feat.named)) out.matched.push({ id: h.id, text: h.text, style: h.style });
    // how sure the model is: share of 64 posterior samples in which each style wins
    const wins = Object.fromEntries(ARMS.map(a => [a, 0]));
    for (let k = 0; k < 64; k++) {
      let best = null, bs = -1;
      for (const a of ARMS) { const s = this.score(a, feat.x, true); if (s > bs) { bs = s; best = a; } }
      wins[best]++;
    }
    out.probs = Object.fromEntries(ARMS.map(a => [a, Math.round(this.score(a, feat.x, false) * 100) / 100]));
    if (override && STYLES[override]) {
      Object.assign(out, { style: override, source: 'you', confidence: 1 });
    } else if (!this.p.settings.adapt) {
      Object.assign(out, { style: null, source: 'off', confidence: 0 });
    } else {
      // How sure the model is overall: the share of posterior samples won by its best style.
      const best = ARMS.reduce((a, c) => (wins[c] > wins[a] ? c : a), ARMS[0]);
      let confidence = wins[best] / 64;
      // Thompson sampling: one random draw from the posterior picks the style, so now and then it tries
      // a style that might be better ("explore"), which is how it notices when the user changes.
      let pick = best, source = 'auto';
      if (!preview) {
        let ps = -1;
        for (const a of ARMS) { const s = this.score(a, feat.x, EXPLORE); if (s > ps) { ps = s; pick = a; } }
        // never "try" the style that just missed again straight away
        if (feat.named.after_bad_answer && this.p.last && pick === this.p.last.style) pick = best;
        if (pick !== best) source = 'explore';
      }
      // a stated or promoted pattern decides when the model is unsure, unless matching patterns disagree
      const styles = new Set(out.matched.map(m => m.style));
      const hyp = styles.size === 1 ? out.matched[0] : null;
      const justFailed = feat.named.after_bad_answer && this.p.last && this.p.last.style === (hyp && hyp.style);
      if (hyp && !justFailed && confidence < 0.6 && hyp.style !== pick) { pick = hyp.style; confidence = Math.max(wins[pick] / 64, 0.6); source = 'pattern'; }
      if (confidence < 0.4 && source !== 'pattern') Object.assign(out, { style: null, source: 'unsure', confidence });
      else if (!preview && this.random() < this.p.settings.holdout) Object.assign(out, { style: null, wouldBe: pick, source: 'holdout', confidence });
      else Object.assign(out, { style: pick, source, confidence });
    }
    out.confidence = Math.round(out.confidence * 100) / 100;
    out.directive = out.style ? this.directive(out.style, feat, out.confidence) : '';
    out.label = out.style ? `${out.state.label} · ${STYLES[out.style].name}` : out.source === 'off' ? 'Adapting is off' : `${out.state.label} · normal answer`;
    return out;
  }
  directive(style, feat, confidence) {
    const lines = [`RESPONSE STYLE for this message only (chosen by Vyuha from how the user is working right now; confidence ${confidence.toFixed(2)}).`,
      STYLES[style].directive];
    if (feat.named.rephrase || feat.named.after_bad_answer) lines.push('The previous reply may not have been what the user wanted; don’t repeat it.');
    lines.push('This changes only length, depth and structure, never the substance: still point out mistakes, risks or problems plainly. If the user explicitly asks for a different length or depth, follow the user.');
    return lines.join('\n');
  }

  /* ---------- the loop ---------- */
  // Called when the user sends a message. Closes the previous interaction (its outcome is now known),
  // then decides how to answer this one.
  begin(pid, text, { typing, reading, context, override } = {}) {
    const t = this.now();
    if (!this.p.settings.collect) { this.lastText.set(pid, text); return { style: null, source: 'off', directive: '', label: 'Off' }; }
    const feat = this.features(pid, text, typing, context);
    const prev = this.pending.get(pid);
    if (prev) {
      this.finish(pid, { next: text, nextFeat: feat, reading });
      // the previous reply has just been scored, so "after a bad answer" can use that score
      const bad = this.p.last && this.p.last.reward != null && this.p.last.reward < 0.4 ? 1 : 0;
      feat.named.after_bad_answer = bad;
      feat.x[X_NAMES.indexOf('after_bad_answer')] = bad;
    }
    const d = this.decide(feat, override);
    this.pending.set(pid, { t, feat, decision: d, signals: { copied: 0, approved: 0, denied: 0, task: 0, opened: 0 } });
    this.lastText.set(pid, text);
    if (!this.session.last || t - this.session.last > 30 * 60e3) this.session.start = t;
    this.session.last = t;
    // remember this message in the user's normal
    for (const f of Z_FEATURES) {
      const v = feat.raw[f];
      if (v == null) continue;
      const h = this.p.history[f];
      h.push(f === 'words' ? Math.log1p(v) : v);
      if (h.length > 200) h.splice(0, h.length - 200);
    }
    this.p.stats.messages++;
    if (d.source === 'you') this.p.stats.overrides++;
    if (d.source !== 'off') this.p.stats.decided++;
    this.p.last = { ...(this.p.last || {}), t, state: d.state, style: d.style, source: d.source, confidence: d.confidence, label: d.label, reward: this.p.last ? this.p.last.reward : null };
    this.save();
    return d;
  }
  // Something happened after the reply (approved a command, copied code, ticked a task, opened a source)
  note(pid, kind) {
    const p = this.pending.get(pid);
    if (p && kind in p.signals) p.signals[kind]++;
  }
  // The outcome of the last reply is known: score it and learn from it.
  finish(pid, { next, nextFeat, reading } = {}) {
    const p = this.pending.get(pid);
    if (!p) return null;
    this.pending.delete(pid);
    const s = p.signals, d = p.decision;
    const style = d.style || d.wouldBe || null;
    const rephrase = nextFeat ? nextFeat.named.rephrase : 0;
    const gap = nextFeat ? this.now() - p.t : Infinity;
    const followup = next != null && gap < 30 * 60e3;
    let reward = 0.5;
    reward += 0.25 * Math.min(1, s.copied) + 0.2 * Math.min(1, s.approved) - 0.15 * Math.min(1, s.denied) + 0.2 * Math.min(1, s.task) + 0.1 * Math.min(1, s.opened);
    if (followup && !rephrase) reward += 0.1;
    if (rephrase) reward -= 0.45;
    if (next && NEG.test(next)) reward -= 0.35;
    if (next && POS.test(next)) reward += 0.15;   // kept small on purpose: progress matters more than praise
    const wantShort = next && WANT_SHORT.test(next), wantMore = next && WANT_MORE.test(next);
    if (wantShort && (style === 'deep' || style === 'stepwise')) reward -= 0.35;
    if (wantMore && (style === 'overview' || style === 'clarify')) reward -= 0.35;
    // reading: replies scrolled past much faster than anyone reads (~15 words/sec) count against long styles
    if (reading && reading.skimmed && (style === 'deep' || style === 'stepwise')) reward -= 0.1;
    reward = Math.round(clip(reward, 0, 1) * 100) / 100;

    // train the bandit (only when Vyuha chose the style, or the user picked it: a direct label)
    if (d.source === 'you') {
      this.update(d.style, p.feat.x, Math.max(reward, 0.8), 3);   // the user's own choice weighs like ~3 observations
      const guess = d.wouldBe || this.bestArm(p.feat.x);
      if (guess && guess !== d.style) this.update(guess, p.feat.x, 0, 3);
    } else if (d.style && (d.source === 'auto' || d.source === 'pattern' || d.source === 'explore')) {
      this.update(d.style, p.feat.x, reward, 1);
    }
    // evidence for and against hypotheses
    for (const h of this.p.hypotheses) {
      if (!h.enabled || h.status === 'retired' || !this.matches(h, p.feat.named)) continue;
      if (d.source === 'you') { if (d.style === h.style) h.support++; else h.against++; }
      else if (d.style === h.style) { if (reward >= 0.6) h.support++; else if (reward <= 0.4) h.against++; }
      const n = h.support + h.against;
      if (h.status === 'testing' && n >= 15 && h.support / n >= 0.75) h.status = 'promoted';
      else if (h.status === 'testing' && n >= 15 && h.support / n < 0.4) h.status = 'retired';
      else if (h.status === 'promoted' && n >= 25 && h.support / n < 0.5) h.status = 'testing';
      h.contradicted = h.status === 'stated' && n >= 15 && h.support / n < 0.4;
    }
    const st = this.p.stats;
    const bucket = d.source === 'holdout' ? 'holdout' : d.style ? 'adaptive' : null;
    if (bucket) { st.rewards[bucket].push(reward); if (st.rewards[bucket].length > 200) st.rewards[bucket].shift(); }
    if (nextFeat) { st.rephrases.push(rephrase); if (st.rephrases.length > 200) st.rephrases.shift(); }
    st.sinceAnalysis++;
    if (this.p.last) this.p.last.reward = reward;
    this.appendLog({ t: new Date(p.t).toISOString(), f: p.feat.named, raw: p.feat.raw, style: d.style, source: d.source, wouldBe: d.wouldBe || null,
                     confidence: d.confidence, signals: s, rephrase, reward,
                     reading: reading ? { readMs: reading.readMs, words: reading.words, skimmed: !!reading.skimmed, scrollUps: reading.scrollUps || 0, mouse: reading.mouse || 0 } : null });
    this.save();
    return { reward, style, source: d.source };
  }
  finishAll() { for (const pid of [...this.pending.keys()]) this.finish(pid, {}); }

  bestArm(x) { let best = null, bs = -1; for (const a of ARMS) { const s = this.score(a, x, false); if (s > bs) { bs = s; best = a; } } return best; }
  // Bayesian logistic regression with a diagonal Gaussian posterior (Laplace approximation), one observation at a time.
  update(arm, x, y, weight = 1) {
    const b = this.p.bandit[arm];
    if (!b) return;
    for (let k = 0; k < weight; k++) {
      const p = this.score(arm, x, false);
      for (let i = 0; i < x.length; i++) {
        if (!x[i]) continue;
        b.q[i] += p * (1 - p) * x[i] * x[i];
        b.m[i] += clip(((y - p) * x[i]) / b.q[i], -MAX_STEP, MAX_STEP);
      }
    }
    b.n++;
  }

  /* ---------- the analyst (slow loop) ---------- */
  needsAnalysis() {
    const st = this.p.stats;
    return st.sinceAnalysis >= 50 || (st.sinceAnalysis >= 15 && this.now() - (st.lastAnalysis || 0) > 7 * 86400e3);
  }
  // Aggregate numbers only: no text, no timings of single keystrokes.
  analystInput() {
    const lines = fs.existsSync(this.log) ? fs.readFileSync(this.log, 'utf8').trim().split('\n').slice(-400) : [];
    const recs = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    const lvl = v => (v < -0.5 ? 'low' : v > 0.5 ? 'high' : 'mid');
    const buckets = {};
    for (const r of recs) {
      const f = r.f || {};
      const key = `specificity:${lvl(f.specificity_z)} words:${lvl(f.words_z)} phase:${f.early_phase ? 'early' : 'later'} mode:${f.build_mode ? 'build' : 'teach'} time:${f.late_night ? 'late' : 'day'}${f.rephrase ? ' rephrase' : ''}`;
      const b = buckets[key] || (buckets[key] = { n: 0, styles: {} });
      b.n++;
      const st = r.style || (r.source === 'holdout' ? 'none (holdout)' : 'none');
      const s = b.styles[st] || (b.styles[st] = { n: 0, reward: 0, chosenByUser: 0 });
      s.n++; s.reward += r.reward; if (r.source === 'you') s.chosenByUser++;
    }
    for (const b of Object.values(buckets)) for (const s of Object.values(b.styles)) s.reward = Math.round((s.reward / s.n) * 100) / 100;
    const avg = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
    return {
      messages: recs.length,
      features: FEATURE_NAMES,
      styles: Object.fromEntries(ARMS.map(a => [a, STYLES[a].name])),
      buckets,
      rewardAdaptive: avg(this.p.stats.rewards.adaptive),
      rewardHoldout: avg(this.p.stats.rewards.holdout),
      hypotheses: this.p.hypotheses.map(h => ({ id: h.id, text: h.text, when: h.when, style: h.style, status: h.status, source: h.source, support: h.support, against: h.against }))
    };
  }
  applyAnalysis(res) {
    if (!res) return 0;
    let added = 0;
    for (const n of (res.new || []).slice(0, 3)) {
      if (!n || !STYLES[n.style] || !Array.isArray(n.when) || !n.when.length) continue;
      const when = n.when.filter(c => FEATURE_NAMES.includes(c.feature) && ['<', '>', '='].includes(c.op) && Number.isFinite(Number(c.value)))
        .map(c => ({ feature: c.feature, op: c.op, value: Number(c.value) }));
      if (!when.length) continue;
      const sig = JSON.stringify([when, n.style]);
      if (this.p.hypotheses.some(h => JSON.stringify([h.when, h.style]) === sig)) continue;
      this.p.hypotheses.push({ id: 'h' + this.now().toString(36) + added, text: String(n.text || '').slice(0, 240), source: 'analyst', status: 'testing',
                               when, style: n.style, support: 0, against: 0, enabled: true, created: new Date(this.now()).toISOString() });
      added++;
    }
    for (const r of res.retire || []) {
      const h = this.p.hypotheses.find(x => x.id === r.id);
      if (h && h.source !== 'you' && h.status === 'testing') { h.status = 'retired'; h.why = String(r.why || '').slice(0, 200); }
    }
    this.p.analysis = { at: new Date(this.now()).toISOString(), notes: String(res.notes || '').slice(0, 1200), added };
    this.p.stats.sinceAnalysis = 0;
    this.p.stats.lastAnalysis = this.now();
    this.save();
    return added;
  }

  /* ---------- editing from the "How Vyuha sees you" page ---------- */
  edit(op, a = {}) {
    const hs = this.p.hypotheses;
    const h = a.id && hs.find(x => x.id === a.id);
    switch (op) {
      case 'toggle': if (h) h.enabled = !h.enabled; break;
      case 'delete': if (h) hs.splice(hs.indexOf(h), 1); break;
      case 'add': {
        if (!STYLES[a.style] || !Array.isArray(a.when) || !a.when.length) throw new Error('Pick a situation and a style.');
        hs.push({ id: 'h' + this.now().toString(36), text: String(a.text || '').slice(0, 240) || 'My own rule', source: 'you', status: 'stated',
                  when: a.when.filter(c => FEATURE_NAMES.includes(c.feature)), style: a.style, support: 0, against: 0, enabled: true,
                  created: new Date(this.now()).toISOString() });
        break;
      }
      case 'settings': Object.assign(this.p.settings, {
        ...(a.collect !== undefined ? { collect: !!a.collect } : {}),
        ...(a.adapt !== undefined ? { adapt: !!a.adapt } : {}) }); break;
      case 'reset': {
        this.pending.clear(); this.lastText.clear();
        const keep = this.p.settings;
        this.p = this.fresh(); this.p.settings = keep;
        try { fs.rmSync(this.log, { force: true }); } catch (e) { /* ignore */ }
        break;
      }
      default: throw new Error('Unknown change');
    }
    this.save();
    return this.summary();
  }

  /* ---------- what the UI shows ---------- */
  summary() {
    const st = this.p.stats;
    const avg = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
    const rr = st.rephrases;
    return {
      settings: this.p.settings,
      messages: st.messages,
      last: this.p.last,
      baselines: Object.fromEntries(Z_FEATURES.map(f => {
        const b = this.baseline(f);
        return [f, { median: Math.round((f === 'words' ? Math.expm1(b.median) : b.median) * 100) / 100, own: b.own, n: b.n }];
      })),
      styles: ARMS.map(a => ({ id: a, name: STYLES[a].name, learned: this.p.bandit[a].n })),
      hypotheses: this.p.hypotheses,
      agreement: st.decided ? Math.round((1 - st.overrides / st.decided) * 100) / 100 : null,
      rewardAdaptive: avg(st.rewards.adaptive), rewardHoldout: avg(st.rewards.holdout),
      nAdaptive: st.rewards.adaptive.length, nHoldout: st.rewards.holdout.length,
      rephraseRecent: rr.length >= 10 ? avg(rr.slice(-50)) : null,
      rephraseEarlier: rr.length >= 60 ? avg(rr.slice(0, -50)) : null,
      analysis: this.p.analysis,
      sinceAnalysis: st.sinceAnalysis,
      dir: this.dir
    };
  }
}

module.exports = { Behaviour, STYLES, ARMS, FEATURE_NAMES, textFeatures, similarity };
