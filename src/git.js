// Source control for a project folder, using the git command line (like VS Code does).
// GitHub access uses a personal access token, sent as an HTTP header for each
// push/pull/clone so it is never written into the repository's config or remote URL.
const { execFile } = require('child_process');
const path = require('path');

function run(cwd, args, { token, timeout = 120000 } = {}) {
  const auth = token
    ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from('x-access-token:' + token).toString('base64')}`]
    : [];
  return new Promise(resolve => {
    execFile('git', [...auth, ...args], {
      cwd, timeout, maxBuffer: 30 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ code: 127, stdout: '', stderr: 'Git is not installed. On a Mac, run `xcode-select --install` in Terminal.', missing: true });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Turn git's error output into one readable line
function errorText(r) {
  const s = (r.stderr || r.stdout || '').trim();
  if (/Please tell me who you are|unable to auto-detect email/i.test(s)) return 'NEEDS_IDENTITY';
  if (/Authentication failed|could not read Username|403|terminal prompts disabled/i.test(s)) return 'GitHub refused access. Add a GitHub token in Settings (it needs the "repo" permission).';
  if (/non-fast-forward|fetch first|rejected/i.test(s)) return 'GitHub has commits you don’t have yet. Pull first, then push.';
  if (/Not possible to fast-forward|diverging branches/i.test(s)) return 'Your branch and GitHub’s have both changed. Resolve it in the terminal, e.g. git pull --rebase.';
  if (/no upstream|has no upstream/i.test(s)) return 'This branch isn’t on GitHub yet. Use Push.';
  const line = s.split('\n').filter(l => l && !/^hint:/.test(l)).slice(-2).join(' ');
  return line.replace(/^(fatal|error):\s*/i, '') || 'Git failed';
}

const parseGithub = url => {
  const m = String(url || '').match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2], url: `https://github.com/${m[1]}/${m[2]}` } : null;
};

async function status(cwd) {
  const top = await run(cwd, ['rev-parse', '--show-toplevel']);
  if (top.missing) return { repo: false, gitMissing: true };
  if (top.code !== 0) return { repo: false };
  const root = top.stdout.trim();
  const st = await run(cwd, ['status', '--porcelain=v1', '-b', '-uall']);
  const lines = st.stdout.split('\n').filter(Boolean);
  const head = lines.shift() || '';
  const out = { repo: true, root, rootIsProject: path.resolve(root) === path.resolve(cwd), branch: '', upstream: '', ahead: 0, behind: 0, noCommits: false, files: [] };
  let m;
  if ((m = head.match(/^## No commits yet on (.+)$/))) { out.branch = m[1]; out.noCommits = true; }
  else if ((m = head.match(/^## ([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.+)\])?/))) {
    out.branch = m[1]; out.upstream = m[2] || '';
    const a = (m[3] || '').match(/ahead (\d+)/), b = (m[3] || '').match(/behind (\d+)/);
    out.ahead = a ? +a[1] : 0; out.behind = b ? +b[1] : 0;
  }
  // paths are relative to the repo root; show them relative to the project folder
  const rel = p => path.relative(cwd, path.join(root, p)).split(path.sep).join('/');
  for (const l of lines) {
    const x = l[0], y = l[1];
    let file = l.slice(3), orig = null;
    if (file.includes(' -> ')) [orig, file] = file.split(' -> ');
    file = file.replace(/^"|"$/g, '');
    const code = x === '?' ? 'U' : (y !== ' ' ? y : x);   // U = untracked (new)
    out.files.push({ path: rel(file), orig: orig ? rel(orig) : null, code, staged: x !== ' ' && x !== '?' });
  }
  const remote = await run(cwd, ['remote', 'get-url', 'origin']);
  out.remote = remote.code === 0 ? remote.stdout.trim() : '';
  out.github = parseGithub(out.remote);
  if (!out.noCommits) {
    const log = await run(cwd, ['log', '-n', '15', '--pretty=format:%h%x09%s%x09%cr%x09%an']);
    out.commits = log.stdout.split('\n').filter(Boolean).map(l => { const [hash, subject, when, author] = l.split('\t'); return { hash, subject, when, author }; });
  } else out.commits = [];
  return out;
}

// Keep Vyuha's own notes folder out of the repository without touching the user's .gitignore
async function excludeVyuha(cwd) {
  const fs = require('fs');
  const g = await run(cwd, ['rev-parse', '--git-path', 'info/exclude']);
  if (g.code !== 0) return;
  const file = path.resolve(cwd, g.stdout.trim());
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { /* none yet */ }
  if (!/^\.vyuha\/?$/m.test(text)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text + (text && !text.endsWith('\n') ? '\n' : '') + '.vyuha/\n');
  }
}

module.exports = { run, status, errorText, parseGithub, excludeVyuha };
