// Error grouping and matching on realistic, noisy test-runner output. Run: node test/team.noisy.test.js
// Each fixture comes in two variants, as two teammates would see the same failure on their machines
// (different home folders, stack depth, timings, pass/fail counts, npm log file names), plus an unrelated
// failure with the same errorType but a different message.
const assert = require('assert');
const T = require('../src/team');
const H = require('./team-helpers');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('ok ', msg); };
const now = H.clock('2026-11-10T09:00:00Z');

const npmA = `
> shop-web@1.0.0 test
> jest --runInBand

 PASS  tests/cart.test.js (2.913 s)
 FAIL  tests/login.test.js (5.123 s)
  ● login › signs in with a valid password

    AxiosError: Request failed with status code 401

      at settle (node_modules/axios/lib/core/settle.js:19:12)
      at IncomingMessage.handleStreamEnd (node_modules/axios/lib/adapters/http.js:572:11)
      at login (/Users/priya/code/shop-web/src/auth/session.js:41:13)
      at Object.<anonymous> (/Users/priya/code/shop-web/tests/login.test.js:12:5)

Test Suites: 1 failed, 4 passed, 5 total
Tests:       1 failed, 11 passed, 12 total
Snapshots:   0 total
Time:        8.214 s
Ran all test suites.
npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm ERR! shop-web@1.0.0 test: \`jest --runInBand\`
npm ERR! Exit status 1
npm ERR! Failed at the shop-web@1.0.0 test script.
npm ERR! A complete log of this run can be found in:
npm ERR!     /Users/priya/.npm/_logs/2026-11-09T10_12_33_456Z-debug-0.log
`;
const npmB = `
> shop-web@1.0.0 test
> jest --runInBand

npm WARN deprecated inflight@1.0.6: This module is not supported
 PASS  tests/cart.test.js
 PASS  tests/products.test.js (3.402 s)
 FAIL  tests/login.test.js (11.87 s)
  ● login › signs in with a valid password

    AxiosError: Request failed with status code 401

      at settle (node_modules/axios/lib/core/settle.js:19:12)
      at IncomingMessage.handleStreamEnd (node_modules/axios/lib/adapters/http.js:572:11)
      at IncomingMessage.emit (node:events:531:35)
      at endReadableNT (node:internal/streams/readable:1698:12)
      at AxiosError.from (node_modules/axios/lib/core/AxiosError.js:89:14)
      at login (C:\\Users\\ravi\\work\\shop-web\\src\\auth\\session.js:44:13)
      at Object.<anonymous> (C:\\Users\\ravi\\work\\shop-web\\tests\\login.test.js:12:5)

Test Suites: 1 failed, 6 passed, 7 total
Tests:       1 failed, 2 skipped, 19 passed, 22 total
Snapshots:   0 total
Time:        14.03 s
Ran all test suites.
npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm ERR! shop-web@1.0.0 test: \`jest --runInBand\`
npm ERR! Exit status 1
npm ERR! Failed at the shop-web@1.0.0 test script.
npm ERR! A complete log of this run can be found in:
npm ERR!     C:\\Users\\ravi\\AppData\\Local\\npm-cache\\_logs\\2026-11-09T14_51_02_019Z-debug-0.log
`;
const npmUnrelated = `
> shop-web@1.0.0 test
> jest --runInBand

 FAIL  tests/products.test.js (4.001 s)
  ● products › lists products for a category

    AxiosError: Request failed with status code 404

      at settle (node_modules/axios/lib/core/settle.js:19:12)
      at IncomingMessage.handleStreamEnd (node_modules/axios/lib/adapters/http.js:572:11)
      at listProducts (/Users/tom/shop-web/src/catalog/api.js:22:9)

Test Suites: 1 failed, 4 passed, 5 total
Tests:       1 failed, 11 passed, 12 total
Time:        6.551 s
npm ERR! code ELIFECYCLE
npm ERR! Failed at the shop-web@1.0.0 test script.
npm ERR!     /Users/tom/.npm/_logs/2026-11-09T16_00_09_101Z-debug-0.log
`;

const pyA = `============================= test session starts ==============================
platform darwin -- Python 3.11.4, pytest-7.4.0, pluggy-1.2.0
rootdir: /Users/meera/sentiment
collected 14 items

tests/test_data.py .......                                               [ 50%]
tests/test_train.py ....F..                                              [100%]

=================================== FAILURES ===================================
_______________________________ test_load_model ________________________________

    def test_load_model():
>       model = load_model("models/clf.pkl")

tests/test_train.py:21:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

path = 'models/clf.pkl'

    def load_model(path):
>       with open(path, "rb") as f:
E       FileNotFoundError: [Errno 2] No such file or directory: 'models/clf.pkl'

src/model.py:8: FileNotFoundError
=========================== short test summary info ============================
FAILED tests/test_train.py::test_load_model - FileNotFoundError: [Errno 2] No such file or directory: 'models/clf.pkl'
========================= 1 failed, 13 passed in 2.31s =========================
`;
const pyB = `============================= test session starts ==============================
platform win32 -- Python 3.12.1, pytest-8.0.2, pluggy-1.4.0
rootdir: C:\\Users\\asha\\projects\\sentiment
plugins: cov-4.1.0
collected 19 items

tests\\test_data.py .........                                             [ 47%]
tests\\test_eval.py ...                                                   [ 63%]
tests\\test_train.py ......F                                              [100%]

=================================== FAILURES ===================================
_______________________________ test_load_model ________________________________

    def test_load_model():
>       model = load_model("models/clf.pkl")

tests\\test_train.py:21:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
src\\model.py:5: in load_model
    return _read(path)
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

path = 'models/clf.pkl'

    def _read(path):
>       with open(path, "rb") as f:
E       FileNotFoundError: [Errno 2] No such file or directory: 'models/clf.pkl'

src\\model.py:11: FileNotFoundError
=========================== short test summary info ============================
FAILED tests/test_train.py::test_load_model - FileNotFoundError: [Errno 2] No such file or directory: 'models/clf.pkl'
=================== 1 failed, 18 passed, 3 warnings in 7.85s ===================
`;
const pyUnrelated = `============================= test session starts ==============================
platform linux -- Python 3.11.4, pytest-7.4.0, pluggy-1.2.0
collected 14 items

tests/test_data.py ...F...                                               [ 50%]
tests/test_train.py .......                                              [100%]

=================================== FAILURES ===================================
______________________________ test_load_reviews _______________________________

    def test_load_reviews():
>       df = load_reviews("data/reviews.csv")

tests/test_data.py:14:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
src/data.py:5: in load_reviews
    return pd.read_csv(path)
E   FileNotFoundError: [Errno 2] No such file or directory: 'data/reviews.csv'

src/data.py:5: FileNotFoundError
=========================== short test summary info ============================
FAILED tests/test_data.py::test_load_reviews - FileNotFoundError: [Errno 2] No such file or directory: 'data/reviews.csv'
========================= 1 failed, 13 passed in 1.02s =========================
`;

// a published card as a teammate's Team would have made it from their output
const cardFrom = (id, by, command, output) => ({ id, by, status: 'fixed', command, signature: T.signature(output), errorType: T.errorTypeOf(output),
  errorLines: T.errorBlock(output), errorExcerpt: output.slice(-1500), filesChanged: [], title: id });
const score = (output, command, card) => T.matchIssues(output, command, [], [card], { threshold: 0 })[0].score;

(async () => {
  const cases = [
    { name: 'npm/jest', cmd: 'npm test', A: npmA, B: npmB, U: npmUnrelated, ucmd: 'npm test' },
    { name: 'pytest', cmd: 'pytest -q', A: pyA, B: pyB, U: pyUnrelated, ucmd: 'pytest tests/test_data.py' }
  ];
  const rows = [];
  for (const c of cases) {
    const sa = T.signature(c.A), sb = T.signature(c.B);
    if (sa !== sb) console.log('    A key:', sa, '\n    B key:', sb, '\n    B lines:', T.errorLines(c.B));
    ok(sa === sb, `${c.name}: both variants have the same grouping key: ${sa}`);
    ok(T.errorTypeOf(c.U) === T.errorTypeOf(c.A) && T.signature(c.U) !== sa, `${c.name}: the unrelated error has the same errorType (${T.errorTypeOf(c.U)}) but a different key: ${T.signature(c.U)}`);
    const cardA = cardFrom(c.name + '-A', 'priya', c.cmd, c.A), cardB = cardFrom(c.name + '-B', 'ravi', c.cmd, c.B);
    const ab = score(c.B, c.cmd, cardA), ba = score(c.A, c.cmd, cardB);
    const ua = score(c.U, c.ucmd, cardA), ub = score(c.U, c.ucmd, cardB);
    rows.push([c.name, 'B against A\u2019s card', ab], [c.name, 'A against B\u2019s card', ba], [c.name, 'unrelated against A', ua], [c.name, 'unrelated against B', ub]);
    ok(ab >= 0.55 && ba >= 0.55, `${c.name}: the variants match each other above 0.55 (B→A ${ab}, A→B ${ba})`);
    ok(ua < 0.55 && ub < 0.55, `${c.name}: the unrelated same-type error stays below 0.55 (→A ${ua}, →B ${ub})`);
    ok(T.matchIssues(c.U, c.ucmd, [], [cardA, cardB]).length === 0 && T.matchIssues(c.B, c.cmd, [], [cardA]).length === 1, `${c.name}: matchIssues returns the variant and drops the unrelated one`);
  }
  console.log('\n    scores (threshold 0.55):');
  for (const [n, what, s] of rows) console.log(`    ${n.padEnd(9)} ${what.padEnd(22)} ${s.toFixed(3)}  ${s >= 0.55 ? 'match' : 'no match'}`);
  console.log('');

  // the two variants of each case group as ONE issue for the person who hits both
  const bare = H.makeRemote('noisy');
  const root = H.cloneFor(bare, { id: 'meera', name: 'Meera', email: 'meera@example.com' }, 'noisy');
  const tm = new T.Team({ root, project: 'noisy', now, random: H.rng(5), home: root });
  await tm.setup();
  for (const c of cases) {
    await tm.afterCommand({ command: c.cmd, exitCode: 1, output: c.A }); now.minutes(1);
    await tm.afterCommand({ command: c.cmd, exitCode: 1, output: c.B }); now.minutes(1);
  }
  await tm.afterCommand({ command: 'npm test', exitCode: 1, output: npmUnrelated });
  const list = tm.localIssues();
  const npm = list.filter(i => i.command === 'npm test'), py = list.filter(i => i.command === 'pytest -q');
  ok(py.length === 1 && py[0].attempts === 2, 'pytest: the two variants are one issue with attempts 2');
  ok(npm.length === 2 && npm.some(i => i.attempts === 2 && i.errorType === 'AxiosError' && /401/.test(i.signature)) && npm.some(i => i.attempts === 1 && /404/.test(i.signature)),
     'npm: the two 401 variants are one issue (attempts 2); the 404 with the same errorType is a separate issue');
  ok(list.every(i => Array.isArray(i.errorLines) && i.errorLines.length && i.errorLines.length <= 20 && !i.errorLines.join(' ').includes('/Users/')), 'issues store up to 20 normalised error lines (no home paths)');
  console.log('all noisy output checks passed');
})().catch(e => { console.error(e); process.exit(1); });
