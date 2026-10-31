/**
 * @file main/apps/bash.js
 * @layer L6 (Application)
 * @owns  window.BashApp
 * @needs [ 'CommandEngine', 'Kernel.syscall', 'AppRegistry' ]
 * @description
 * POSIX Bash (bash) L6 application.
 * Uses CommandEngine for parsing, pipes, redirection, and job control.
 * Provides POSIX Bash dialect:
 * - POSIX path resolution (/mnt/c, /home/user, /dev, /proc, /tmp).
 * - Standard builtins (ls, cd, cat, pwd, clear, rm, mkdir, cp, touch,
 *   export, echo, jobs, kill, whoami, date, exit, help).
 * - user@hostname:path$ prompt formatting.
 * - Aliased as legacy 'terminal' in AppRegistry.
 */

(function (root) {
  'use strict';

  const VERSION = '20261031';
  let readyResolve;
  const ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  const BASH_BANNER = [
    'GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)',
    'These shell commands are defined internally. Type `help\' to see this list.\n'
  ].join('\n');

  function getSyscall() {
    if (root.Kernel && typeof root.Kernel.syscall === 'function') {
      return root.Kernel.syscall.bind(root.Kernel);
    }
    if (root.KernelSyscalls && typeof root.KernelSyscalls.syscall === 'function') {
      return root.KernelSyscalls.syscall.bind(root.KernelSyscalls);
    }
    return null;
  }

  function createBashSession(options) {
    const opts = options || {};
    const siteOwner = root.SiteConfig && root.SiteConfig.owner;
    const desktopConfig = root.SiteConfig && root.SiteConfig.desktop;
    const defaultUser = (siteOwner && (siteOwner.legacyUsername || siteOwner.displayName)) || 'user';
    const defaultHost = (desktopConfig && desktopConfig.hostname) || 'desktop';

    let cwd = opts.cwd || `/home/${defaultUser}`;
    const env = Object.assign({
      SHELL: '/bin/bash',
      USER: defaultUser,
      HOME: `/home/${defaultUser}`,
      HOST: defaultHost,
      TERM: 'xterm-256color',
      PATH: '/bin:/usr/bin:/usr/local/bin'
    }, opts.env || {});

    const builtins = {};

    builtins.echo = function (args) {
      return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
    };

    builtins.pwd = function () {
      return { stdout: cwd + '\n', stderr: '', exitCode: 0 };
    };

    builtins.whoami = function () {
      return { stdout: (env.USER || 'user') + '\n', stderr: '', exitCode: 0 };
    };

    builtins.date = function () {
      return { stdout: new Date().toUTCString() + '\n', stderr: '', exitCode: 0 };
    };

    builtins.clear = function () {
      return { stdout: '\x1b[2J\x1b[H', stderr: '', exitCode: 0, clearScreen: true };
    };

    builtins.cd = async function (args, stdin, ctx) {
      let target = args[0] || env.HOME || `/home/${env.USER || 'user'}`;
      if (target === '~' || target === '~/') {
        target = env.HOME || `/home/${env.USER || 'user'}`;
      } else if (target.startsWith('~/')) {
        target = (env.HOME || `/home/${env.USER || 'user'}`) + target.slice(1);
      }

      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'bash') : target;
      if (call) {
        try {
          const stat = await call(ctx, 'fs.stat', { path: resolved });
          if (stat && stat.type === 'directory') {
            cwd = resolved;
            return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
          }
        } catch (err) {
          return { stdout: '', stderr: `bash: cd: ${target}: No such file or directory\n`, exitCode: 1 };
        }
      }
      cwd = resolved;
      return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
    };

    builtins.ls = async function (args, stdin, ctx) {
      const showLong = args.includes('-l') || args.includes('-la') || args.includes('-al');
      const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
      const targetArgs = args.filter(a => !a.startsWith('-'));
      const target = targetArgs[0] || cwd;

      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'bash') : target;
      if (!call) {
        return { stdout: `(ls: no filesystem service)\n`, stderr: '', exitCode: 0 };
      }

      try {
        const list = await call(ctx, 'fs.list', { path: resolved });
        const items = list.filter(function (it) {
          if (!showAll && it.name.startsWith('.')) return false;
          return true;
        });

        if (showLong) {
          let out = `total ${items.length}\n`;
          for (const it of items) {
            const isDir = it.type === 'directory';
            const perm = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
            const size = String(it.size || 0).padStart(6);
            const name = isDir ? it.name + '/' : it.name;
            out += `${perm} 1 ${env.USER || 'user'} ${env.USER || 'user'} ${size} Jan 01 00:00 ${name}\n`;
          }
          return { stdout: out, stderr: '', exitCode: 0 };
        }

        const names = items.map(it => it.type === 'directory' ? it.name + '/' : it.name);
        return { stdout: names.join('  ') + (names.length ? '\n' : ''), stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `ls: cannot access '${target}': No such file or directory\n`, exitCode: 2 };
      }
    };

    builtins.cat = async function (args, stdin, ctx) {
      if (!args[0]) {
        // Echo stdin if no file given
        return { stdout: stdin || '', stderr: '', exitCode: 0 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'bash') : args[0];
      try {
        const res = await call(ctx, 'fs.read', { path: resolved });
        const val = res && res.content ? (res.content.value !== undefined ? res.content.value : res.content) : '';
        return { stdout: val + (val.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `cat: ${args[0]}: No such file or directory\n`, exitCode: 1 };
      }
    };

    builtins.touch = async function (args, stdin, ctx) {
      if (!args[0]) {
        return { stdout: '', stderr: 'touch: missing file operand\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'bash') : args[0];
      try {
        await call(ctx, 'fs.write', { path: resolved, content: '' });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `touch: cannot touch '${args[0]}': ${err.message || 'Error'}\n`, exitCode: 1 };
      }
    };

    builtins.mkdir = async function (args, stdin, ctx) {
      const target = args.find(a => !a.startsWith('-'));
      if (!target) {
        return { stdout: '', stderr: 'mkdir: missing operand\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'bash') : target;
      try {
        await call(ctx, 'fs.write', { path: resolved, content: '', type: 'directory' });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `mkdir: cannot create directory '${target}': ${err.message || 'Error'}\n`, exitCode: 1 };
      }
    };

    builtins.rm = async function (args, stdin, ctx) {
      const target = args.find(a => !a.startsWith('-'));
      if (!target) {
        return { stdout: '', stderr: 'rm: missing operand\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'bash') : target;
      try {
        await call(ctx, 'fs.remove', { path: resolved });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `rm: cannot remove '${target}': No such file or directory\n`, exitCode: 1 };
      }
    };

    builtins.cp = async function (args, stdin, ctx) {
      if (args.length < 2) {
        return { stdout: '', stderr: 'cp: missing destination file operand\n', exitCode: 1 };
      }
      const call = getSyscall();
      const src = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'bash') : args[0];
      const dest = root.CommandEngine ? root.CommandEngine.resolvePath(args[1], cwd, 'bash') : args[1];
      try {
        const res = await call(ctx, 'fs.read', { path: src });
        const val = res && res.content ? (res.content.value !== undefined ? res.content.value : res.content) : '';
        await call(ctx, 'fs.write', { path: dest, content: val });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `cp: cannot stat '${args[0]}': No such file or directory\n`, exitCode: 1 };
      }
    };

    builtins.export = function (args) {
      if (!args[0]) {
        let out = '';
        for (const k of Object.keys(env)) {
          out += `declare -x ${k}="${env[k]}"\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }
      for (const pair of args) {
        const idx = pair.indexOf('=');
        if (idx !== -1) {
          const key = pair.slice(0, idx);
          const val = pair.slice(idx + 1).replace(/^["']|["']$/g, '');
          env[key] = val;
        }
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    builtins.ps = async function (args, stdin, ctx) {
      const call = getSyscall();
      if (!call) return { stdout: '  PID TTY          TIME CMD\n', stderr: '', exitCode: 0 };
      try {
        const res = await call(ctx, 'proc.list');
        const list = res && Array.isArray(res) ? res : (res && res.value) || [];
        let out = '  PID TTY          TIME CMD\n';
        for (const p of list) {
          out += `${String(p.pid).padStart(5)} pts/0    00:00:00 ${p.name || p.appId}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: 'ps: failed to read processes\n', exitCode: 1 };
      }
    };

    builtins.help = function () {
      return {
        stdout: [
          'GNU bash, version 5.1.16(1)-release',
          'These shell commands are defined internally:',
          '  cd [-L|[-P [-e]] [-@]] [dir]      - Change directory',
          '  pwd [-LP]                         - Print working directory',
          '  echo [-neE] [arg ...]             - Write arguments to standard output',
          '  clear                             - Clear screen',
          '  export [-fn] [name[=value] ...]   - Set export attribute for variables',
          '  jobs [-lnprs] [jobspec ...]       - Display status of jobs',
          '  kill [-s sigspec | -n signum] pid - Send signal to process',
          '  whoami                            - Print effective user id',
          '  date                              - Print date and time',
          '  exit [n]                          - Exit the shell\n'
        ].join('\n'),
        stderr: '',
        exitCode: 0
      };
    };

    builtins.exit = function (args, stdin, ctx) {
      if (typeof ctx.closeWindow === 'function') {
        ctx.closeWindow();
      }
      return { stdout: '', stderr: '', exitCode: 0, exit: true };
    };

    function getPrompt() {
      let displayPath = cwd;
      const home = env.HOME || `/home/${env.USER || 'user'}`;
      if (cwd === home) {
        displayPath = '~';
      } else if (cwd.startsWith(home + '/')) {
        displayPath = '~' + cwd.slice(home.length);
      }
      return `${env.USER || 'user'}@${env.HOST || 'desktop'}:${displayPath}$ `;
    }

    async function executeCommand(cmdline, executionCtx) {
      if (!root.CommandEngine) {
        return { stdout: '', stderr: 'CommandEngine not available\n', exitCode: 1 };
      }
      const ctx = Object.assign({
        cwd: cwd,
        env: env,
        dialect: 'bash',
        builtins: builtins,
        uid: env.USER || 'user',
        pid: (executionCtx && executionCtx.pid) || 2003
      }, executionCtx || {});

      const result = await root.CommandEngine.execute(cmdline, ctx);
      return result;
    }

    return {
      get banner() { return BASH_BANNER; },
      get prompt() { return getPrompt(); },
      get cwd() { return cwd; },
      set cwd(val) { cwd = val; },
      env: env,
      builtins: builtins,
      execute: executeCommand
    };
  }

  // Application Registration with AppRegistry (bash and terminal alias)
  if (root.AppRegistry && typeof root.AppRegistry.register === 'function') {
    root.AppRegistry.register({
      id: 'bash',
      name: 'Bash',
      tagline: 'POSIX Bourne-Again SHell',
      meta: 'CLI · POSIX PIPES & REDIRECTION',
      icon: '>_',
      source: 'IN-HOUSE',
      kind: 'system',
      multiple: true,
      launch: function (context, options) {
        if (typeof root.openShellWindow === 'function') {
          return root.openShellWindow('bash', options);
        }
        if (typeof root.openTerminal === 'function') {
          return root.openTerminal(Object.assign({ dialect: 'bash' }, options));
        }
        return null;
      }
    });
  }

  const BashApp = Object.freeze({
    version: VERSION,
    ready: ready,
    banner: BASH_BANNER,
    createSession: createBashSession
  });

  root.BashApp = BashApp;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BashApp: BashApp, createBashSession: createBashSession };
  }
})(typeof window !== 'undefined' ? window : global);
