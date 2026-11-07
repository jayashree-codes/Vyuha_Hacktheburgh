// Quick checks for the prompt router. Run with: npm test
const assert = require('assert');
const r = require('../src/router');

const projects = [
  { id: 'hello-world-site', keywords: ['hello-world', 'hello world site'] },
  { id: 'sentiment-classifier', keywords: ['sentiment', 'classifier'] }
];

function where(text) {
  const { r: route } = r.route(text);
  return { site: route.name, q: r.cleanQuery(text, route), project: (r.detectProject(text, projects) || {}).pid || null };
}

const cases = [
  ['give me youtube videos for learning python', { site: 'YouTube', q: 'learning python', project: null }],
  ['youtube video for python', { site: 'YouTube', q: 'python', project: null }],
  ['find datasets for the sentiment classifier', { site: 'Hugging Face Datasets', project: 'sentiment-classifier' }],
  ['What is a transformer model?', { site: 'Wikipedia', q: 'transformer model', project: null }],
  ['best pizza in edinburgh', { site: 'Google', project: null }]
];

for (const [text, want] of cases) {
  const got = where(text);
  for (const k of Object.keys(want)) assert.strictEqual(got[k], want[k], `${text}: ${k} was ${got[k]}`);
  console.log('ok ', text, '→', got.site, got.project ? `(files to ${got.project})` : '(not saved)');
}

assert.strictEqual(r.classify('https://www.youtube.com/watch?v=abc'), 'video');
assert.strictEqual(r.classify('https://huggingface.co/datasets/stanfordnlp/sst2'), 'dataset');
assert.strictEqual(r.classify('https://docs.python.org/3/'), 'research');
assert.ok(r.looksLikeUrl('github.com/anthropics'));
assert.ok(!r.looksLikeUrl('learn python fast'));
assert.ok(r.AGENT_INTENT.test('Where is the sentiment classifier at?'));
assert.ok(r.looksLikeUrl('localhost:8000'));
assert.strictEqual(r.toUrl('localhost:8000'), 'http://localhost:8000');
assert.strictEqual(r.toUrl('127.0.0.1:5000/api'), 'http://127.0.0.1:5000/api');
assert.strictEqual(r.toUrl('github.com'), 'https://github.com');
assert.ok(r.isLocal('http://localhost:8000/') && r.isLocal('file:///x/index.html') && !r.isLocal('https://github.com'));
console.log('all router checks passed');
