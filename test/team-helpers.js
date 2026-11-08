// Shared helpers for the team context tests: temporary bare remotes and clones with their own identity.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-team-'));
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

// A bare "GitHub" remote with one commit on main
function makeRemote(name) {
  const bare = path.join(tmpRoot, 'remotes', name + '.git');
  fs.mkdirSync(bare, { recursive: true });
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = path.join(tmpRoot, 'seed-' + name);
  fs.mkdirSync(seed, { recursive: true });
  g(seed, 'init', '-q', '-b', 'main');
  g(seed, 'config', 'user.name', 'Seed'); g(seed, 'config', 'user.email', 'seed@example.com');
  g(seed, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(seed, 'README.md'), `# ${name}\n`);
  fs.mkdirSync(path.join(seed, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'auth', 'session.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(seed, 'package.json'), '{"name":"' + name + '"}\n');
  g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'Initial commit');
  g(seed, 'remote', 'add', 'origin', bare);
  g(seed, 'push', '-q', '-u', 'origin', 'main');
  return bare;
}

// A member's clone of a remote, with its own local user.name / user.email
function cloneFor(bare, member, project, dirName = project) {
  const dir = path.join(tmpRoot, 'people', member.id, dirName);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  g(path.dirname(dir), 'clone', '-q', '-c', 'core.autocrlf=false', bare, dirName);
  g(dir, 'config', 'user.name', member.name);
  g(dir, 'config', 'user.email', member.email);
  g(dir, 'config', 'core.autocrlf', 'false');
  return dir;
}

// All files on a remote branch, with contents
function branchFiles(bare, branch) {
  const list = g(bare, 'ls-tree', '-r', '--name-only', branch).split('\n').filter(Boolean);
  return list.map(f => ({ path: f, content: g(bare, 'show', `${branch}:${f}`) }));
}

// A fake clock shared by everyone in a test
function clock(startIso) {
  let t = Date.parse(startIso);
  const now = () => t;
  now.advance = ms => { t += ms; return t; };
  now.minutes = m => { t += m * 60e3; return t; };
  return now;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

module.exports = { tmpRoot, g, makeRemote, cloneFor, branchFiles, clock, rng };
