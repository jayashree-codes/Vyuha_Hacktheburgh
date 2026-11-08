// Team context issues: signatures, scrubbing, detection, resolution, matching. Run: node test/team.issues.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../src/team');
const H = require('./team-helpers');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
const now = H.clock('2026-11-08T09:00:00Z');

const err401 = (dir, line, port) => `> shop@1.0.0 test
> node test.js

Error: Request failed with status code 401
    at login (${dir}${path.sep}auth${path.sep}session.js:${line}:13)
    at http://localhost:${port}/api/login
FAILED 1 test, 2026-11-08T09:${String(line % 60).padStart(2, '0')}:11Z
[exit 1]`;

(async () => {
  // signatures
  const a = T.signature(err401('C:\\Users\\priya\\shop', 41, 3001));
  const b = T.signature(err401('/home/ravi/work/shop', 77, 5173));
  ok(a === b, `same error, different paths/lines/ports/timestamps → same signature:\n    ${a}`);
  ok(a.includes('401') && !a.includes('3001') && !a.includes('priya') && !a.includes('41'), 'signature = errorType + first error line; keeps 401, drops ports, paths, users and numbers');
  ok(T.errorTypeOf(err401('x', 1, 2)) === '401', 'errorType: HTTP status');
  ok(T.errorTypeOf("Traceback (most recent call last):\nModuleNotFoundError: No module named 'pandas'") === 'ModuleNotFoundError', 'errorType: exception name');
  ok(T.errorTypeOf('connect ECONNREFUSED 127.0.0.1:5432') === 'ECONNREFUSED', 'errorType: errno code');
  ok(T.normaliseCommand('  NPM   Test -- --watch ') === 'npm test' && T.normaliseCommand('python train.py --epochs 3') === 'python train.py', 'normalised command = first two words, lowercased');
  ok(T.normaliseLine('at 0xdeadbeef uuid 123e4567-e89b-12d3-a456-426614174000 line 450, took 1234 ms, got 503') === 'at <n> uuid <n> line <n>, took <n> ms, got 503', 'hex, uuids, line numbers and numbers become <n>; 5xx is kept');

  // scrubbing
  const home = 'C:\\Users\\priya';
  const dirty = `token=abc123 password: hunter2 Authorization: Bearer eyJhbGciOi ghp_ABCdef1234567890 github_pat_11AA_bb AIza${'x'.repeat(35)} sk-${'a'.repeat(24)} at ${home}\\shop\\a.js and C:/Users/priya/b.js API_KEY=zzz`;
  const clean = T.scrub(dirty, home);
  ok(!/abc123|hunter2|eyJhbGciOi|ghp_ABC|github_pat_11|AIzax|sk-aaa|zzz|priya/.test(clean) && (clean.match(/\[redacted\]/g) || []).length >= 7 && clean.includes('~\\shop\\a.js') && clean.includes('~/b.js'),
     `scrub redacts tokens, keys and passwords and replaces the home folder with ~:\n    ${clean}`);

  // matching
  const card = { id: 'i-1', by: 'priya', status: 'fixed', command: 'npm test', signature: a, errorType: '401', errorExcerpt: err401('~', 41, 3001), filesChanged: ['auth/session.js'], title: 'Login 401: expired session secret', cause: 'c', fix: 'f' };
  const other = { id: 'i-2', by: 'meera', status: 'open', command: 'python train.py', signature: T.signature("ModuleNotFoundError: No module named 'pandas'"), errorType: 'ModuleNotFoundError', errorExcerpt: '', filesChanged: [] };
  const m1 = T.matchIssues(err401('/home/ravi/x', 9, 8080), 'npm test', [], [card, other]);
  ok(m1.length === 1 && m1[0].issue.id === 'i-1' && m1[0].score >= 0.95 && m1[0].kind === 'fix', `the same 401 matches Priya's card (score ${m1[0] && m1[0].score})`);
  const m2 = T.matchIssues("Traceback...\nKeyError: 'label'\n", 'python eval.py', [], [card, other]);
  ok(m2.length === 0, `an unrelated error matches nothing (best score ${Math.max(...[card, other].map(c => T.matchIssues("Traceback...\nKeyError: 'label'\n", 'python eval.py', [], [c], { threshold: 0 })[0].score))})`);
  const m3 = T.matchIssues("ModuleNotFoundError: No module named 'pandas'", 'python train.py', [], [card, other]);
  ok(m3.length === 1 && m3[0].kind === 'also_stuck', 'someone else\u2019s open issue is offered as "also stuck on this"');

  // hooks without team context do nothing
  const none = await T.geminiCommandHook(null, { command: 'npm test', result: { code: 1, output: 'Error' } });
  ok(JSON.stringify(none.fields) === '{}' && (await T.terminalCommandHook(null, { command: 'x', result: { code: 1, output: '' } })) === null, 'hooks are no-ops without team context');

  // lifecycle against a real repo
  const bare = H.makeRemote('issues');
  const root = H.cloneFor(bare, { id: 'priya', name: 'Priya', email: 'priya@example.com' }, 'issues');
  const seen = [];
  const tm = new T.Team({ root, project: 'issues', now, random: H.rng(9), home: root,
    writeUp: async input => { seen.push(input); return { title: 'Login 401: stale session secret', symptom: 'npm test fails with 401', cause: 'session secret rotated', fix: 'read SESSION_SECRET from env in auth/session.js' }; } });
  await tm.setup();
  const steps = [];
  let r = await T.geminiCommandHook(tm, { command: 'npm test', result: { code: 1, output: err401(root, 41, 3001) }, step: s => steps.push(s) });
  now.minutes(2);
  r = await T.geminiCommandHook(tm, { command: 'npm test -- --verbose', result: { code: 1, output: err401(root, 52, 3007) }, step: s => steps.push(s) });
  let list = tm.localIssues();
  ok(list.length === 1 && list[0].attempts === 2 && list[0].status === 'open' && r.fields.team_issue.attempts === 2, 'two failures with the same signature → one open issue, attempts 2');
  ok(!list[0].errorExcerpt.includes(root) && list[0].errorExcerpt.length <= 1500, 'the stored excerpt is scrubbed (home → ~) and capped at 1500 chars');
  fs.writeFileSync(path.join(root, 'auth', 'session.js'), 'module.exports = { value: process.env.SESSION_SECRET };\n');
  tm.noteFileWritten('auth/session.js');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'scratch\n');   // dirty at resolve time too
  now.minutes(3);
  r = await T.geminiCommandHook(tm, { command: 'npm test', result: { code: 0, output: 'all passed' }, geminiReplies: ['The 401 comes from the session secret; read it from the environment.'] });
  await r.writeUps;
  list = tm.localIssues();
  ok(list[0].status === 'fixed' && list[0].filesChanged.includes('auth/session.js') && list[0].filesChanged.includes('notes.txt'), `a passing run fixes it; filesChanged = ${JSON.stringify(list[0].filesChanged)}`);
  ok(list[0].title === 'Login 401: stale session secret' && list[0].include === true, 'the Gemini write-up fills title/symptom/cause/fix; fixed issues are included by default');
  ok(seen[0].diff.includes('SESSION_SECRET') && seen[0].geminiReplies.length === 1 && !('prompt' in seen[0]), 'write-up input = command, error, files, diff and Gemini replies only');
  ok(seen[0].diff.includes('diff --git a/auth/session.js') && seen[0].diff.includes('+++ b/notes.txt'), 'the write-up diff covers every changed file, including the new untracked notes.txt');

  // diffs for many files stay within 8000 characters, and every file still gets a share
  fs.writeFileSync(path.join(root, 'README.md'), '# changed\n' + 'tracked change line\n'.repeat(400));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'big.js'), '// new file\n' + 'const x = 1;\n'.repeat(2000));
  fs.writeFileSync(path.join(root, 'src', 'small.js'), 'module.exports = 42;\n');
  const d = await tm.diffFor(['README.md', 'src/big.js', 'src/small.js', 'auth/session.js'], 8000);
  ok(d.length <= 8000 && ['a/README.md', 'b/src/big.js', 'b/src/small.js', 'a/auth/session.js'].every(h => d.includes(h)) && d.includes('module.exports = 42') && d.includes('diff cut to fit'),
     `four files (two tracked, two new, ~33k characters of changes) fit in ${d.length} characters with every file present`);
  console.log('all team issue checks passed');
})().catch(e => { console.error(e); process.exit(1); });
