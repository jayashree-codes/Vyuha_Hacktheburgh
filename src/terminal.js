// One command runner per project, used by the Terminal panel and by Gemini.
// Commands run in the project's folder through your login shell, so your usual
// PATH (python, conda, node…) is available. It isn't an interactive terminal:
// programs that wait for keyboard input won't work, but scripts, installs,
// tests and git commands do.
const { spawn } = require('child_process');

class Terminals {
  constructor(onEvent) {
    this.onEvent = onEvent;   // (pid, { data } | { running })
    this.procs = new Map();
    this.buf = new Map();
  }

  output(pid) { return this.buf.get(pid) || ''; }
  isRunning(pid) { return this.procs.has(pid); }
  clear(pid) { this.buf.set(pid, ''); }

  append(pid, s) {
    let b = (this.buf.get(pid) || '') + s;
    if (b.length > 200000) b = b.slice(-150000);
    this.buf.set(pid, b);
    this.onEvent(pid, { data: s });
  }

  run(pid, cwd, cmd, { timeoutMs = 0, by = 'you' } = {}) {
    if (this.procs.has(pid)) return Promise.reject(new Error('A command is already running in this project. Stop it first.'));
    const win = process.platform === 'win32';
    const shell = win ? 'cmd.exe' : (process.env.SHELL || '/bin/zsh');
    const args = win ? ['/d', '/s', '/c', cmd] : ['-lc', cmd];
    this.append(pid, `\n${by === 'gemini' ? '[Gemini] ' : ''}$ ${cmd}\n`);
    const child = spawn(shell, args, {
      cwd, detached: !win,
      env: { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' }
    });
    this.procs.set(pid, child);
    this.onEvent(pid, { running: true });
    let out = '';
    const onData = d => {
      const s = d.toString();
      out += s;
      if (out.length > 100000) out = out.slice(-80000);
      this.append(pid, s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    return new Promise(resolve => {
      let timer = null;
      if (timeoutMs) timer = setTimeout(() => { this.append(pid, `\n[stopped after ${timeoutMs / 1000}s]\n`); this.stop(pid); }, timeoutMs);
      child.on('error', e => onData(Buffer.from(`\n${e.message}\n`)));
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        this.procs.delete(pid);
        this.append(pid, `[exit ${code ?? signal}]\n`);
        this.onEvent(pid, { running: false });
        resolve({ code: code ?? -1, signal, output: out });
      });
    });
  }

  stop(pid) {
    const c = this.procs.get(pid);
    if (!c) return;
    try { if (process.platform !== 'win32') process.kill(-c.pid, 'SIGTERM'); else c.kill(); }
    catch (e) { try { c.kill('SIGTERM'); } catch (err) { /* already gone */ } }
  }

  stopAll() { for (const pid of this.procs.keys()) this.stop(pid); }
}

module.exports = { Terminals };
