/**
 * @file main/apps/cmd.js
 * @layer L6 (Application)
 * @owns  window.CmdShellApp
 * @needs [ 'CommandEngine', 'Kernel.syscall', 'AppRegistry' ]
 * @description
 * Windows Command Prompt (cmd.exe) L6 application.
 * Uses CommandEngine for parsing, pipes, redirection, and job control.
 * Provides Windows CMD dialect (case-insensitive commands, C:\... prompt, %VAR% expansion,
 * and builtins: dir, cd, type, cls, del, md/mkdir, copy, ver, echo, exit, help).
 */

(function (root) {
  'use strict';

  const VERSION = '20261031';
  let readyResolve;
  const ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  const CMD_BANNER = [
    'Microsoft Windows 98 [Version 4.10.1998]',
    '(C) Copyright Microsoft Corp 1981-1998.\n'
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

  function createCmdSession(options) {
    const opts = options || {};
    let cwd = opts.cwd || 'C:\\Users\\user';
    const env = Object.assign({
      OS: 'Windows_98',
      COMSPEC: 'C:\\WINDOWS\\COMMAND.COM',
      PATH: 'C:\\WINDOWS;C:\\WINDOWS\\COMMAND',
      PROMPT: '$P$G',
      USERNAME: (root.SiteConfig && root.SiteConfig.owner && root.SiteConfig.owner.displayName) || 'user'
    }, opts.env || {});

    const builtins = {
      echo: function (args) {
        if (args.length === 0) {
          return { stdout: 'ECHO is on.\n', stderr: '', exitCode: 0 };
        }
        return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
      },

      ver: function () {
        return { stdout: '\nWindows 98 [Version 4.10.1998]\n', stderr: '', exitCode: 0 };
      },

      cls: function () {
        return { stdout: '\x1b[2J\x1b[H', stderr: '', exitCode: 0, clearScreen: true };
      },

      cd: async function (args, stdin, ctx) {
        const target = args[0];
        if (!target) {
          return { stdout: cwd + '\n', stderr: '', exitCode: 0 };
        }
        const call = getSyscall();
        const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'cmd') : target;
        if (call) {
          try {
            const stat = await call(ctx, 'fs.stat', { path: resolved });
            if (stat && stat.type === 'directory') {
              cwd = resolved;
              return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
            }
          } catch (err) {
            return { stdout: '', stderr: `The system cannot find the path specified.\n`, exitCode: 1 };
          }
        }
        cwd = resolved;
        return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
      },

      dir: async function (args, stdin, ctx) {
        const target = args[0] || cwd;
        const call = getSyscall();
        const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'cmd') : target;
        if (!call) {
          return { stdout: ` Volume in drive C has no label.\n Directory of ${resolved}\n\n(no syscall layer)\n`, stderr: '', exitCode: 0 };
        }
        try {
          const list = await call(ctx, 'fs.list', { path: resolved });
          let out = ` Volume in drive C has no label.\n Directory of ${resolved}\n\n`;
          let fileCount = 0;
          let dirCount = 0;
          let totalBytes = 0;

          out += `.              <DIR>\n..             <DIR>\n`;
          for (const item of list) {
            const isDir = item.type === 'directory';
            if (isDir) {
              dirCount++;
              out += `${item.name.padEnd(14)} <DIR>\n`;
            } else {
              fileCount++;
              totalBytes += item.size || 0;
              out += `${item.name.padEnd(14)}       ${String(item.size || 0).padStart(8)} bytes\n`;
            }
          }
          out += `               ${fileCount} file(s)     ${totalBytes} bytes\n`;
          out += `               ${dirCount} dir(s)\n`;
          return { stdout: out, stderr: '', exitCode: 0 };
        } catch (err) {
          return { stdout: '', stderr: 'File Not Found\n', exitCode: 1 };
        }
      },

      type: async function (args, stdin, ctx) {
        if (!args[0]) {
          return { stdout: '', stderr: 'The syntax of the command is incorrect.\n', exitCode: 1 };
        }
        const call = getSyscall();
        const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'cmd') : args[0];
        try {
          const res = await call(ctx, 'fs.read', { path: resolved });
          const val = res && res.content ? (res.content.value !== undefined ? res.content.value : res.content) : '';
          return { stdout: val + (val.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
        } catch (err) {
          return { stdout: '', stderr: 'The system cannot find the file specified.\n', exitCode: 1 };
        }
      },

      del: async function (args, stdin, ctx) {
        if (!args[0]) {
          return { stdout: '', stderr: 'The syntax of the command is incorrect.\n', exitCode: 1 };
        }
        const call = getSyscall();
        const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'cmd') : args[0];
        try {
          await call(ctx, 'fs.remove', { path: resolved });
          return { stdout: '', stderr: '', exitCode: 0 };
        } catch (err) {
          return { stdout: '', stderr: 'Could Not Find ' + args[0] + '\n', exitCode: 1 };
        }
      },

      copy: async function (args, stdin, ctx) {
        if (args.length < 2) {
          return { stdout: '', stderr: 'The syntax of the command is incorrect.\n', exitCode: 1 };
        }
        const call = getSyscall();
        const src = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'cmd') : args[0];
        const dest = root.CommandEngine ? root.CommandEngine.resolvePath(args[1], cwd, 'cmd') : args[1];
        try {
          const res = await call(ctx, 'fs.read', { path: src });
          const val = res && res.content ? (res.content.value !== undefined ? res.content.value : res.content) : '';
          await call(ctx, 'fs.write', { path: dest, content: val });
          return { stdout: '        1 file(s) copied.\n', stderr: '', exitCode: 0 };
        } catch (err) {
          return { stdout: '', stderr: 'The system cannot find the file specified.\n', exitCode: 1 };
        }
      },

      help: function () {
        return {
          stdout: [
            'For more information on a specific command, type HELP command-name',
            'CD             Displays the name of or changes the current directory.',
            'CLS            Clears the screen.',
            'COPY           Copies one or more files to another location.',
            'DEL            Deletes one or more files.',
            'DIR            Displays a list of files and subdirectories in a directory.',
            'ECHO           Displays messages, or turns command-echoing on or off.',
            'EXIT           Quits the CMD.EXE program (closes this window).',
            'HELP           Provides Help information for Windows commands.',
            'TYPE           Displays the contents of a text file.',
            'VER            Displays the Windows version.\n'
          ].join('\n'),
          stderr: '',
          exitCode: 0
        };
      },

      exit: function (args, stdin, ctx) {
        if (typeof ctx.closeWindow === 'function') {
          ctx.closeWindow();
        }
        return { stdout: '', stderr: '', exitCode: 0, exit: true };
      }
    };

    builtins.md = builtins.mkdir = async function (args, stdin, ctx) {
      if (!args[0]) {
        return { stdout: '', stderr: 'The syntax of the command is incorrect.\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'cmd') : args[0];
      try {
        await call(ctx, 'fs.write', { path: resolved, content: '', type: 'directory' });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: 'Directory creation error.\n', exitCode: 1 };
      }
    };

    function getPrompt() {
      return `${cwd}>`;
    }

    async function executeCommand(cmdline, executionCtx) {
      if (!root.CommandEngine) {
        return { stdout: '', stderr: 'CommandEngine not available\n', exitCode: 1 };
      }
      const ctx = Object.assign({
        cwd: cwd,
        env: env,
        dialect: 'cmd',
        builtins: builtins,
        uid: env.USERNAME || 'user',
        pid: (executionCtx && executionCtx.pid) || 2001
      }, executionCtx || {});

      const result = await root.CommandEngine.execute(cmdline, ctx);
      return result;
    }

    return {
      get banner() { return CMD_BANNER; },
      get prompt() { return getPrompt(); },
      get cwd() { return cwd; },
      set cwd(val) { cwd = val; },
      env: env,
      builtins: builtins,
      execute: executeCommand
    };
  }

  // Application Registration with AppRegistry
  if (root.AppRegistry && typeof root.AppRegistry.register === 'function') {
    root.AppRegistry.register({
      id: 'cmd',
      name: 'Command Prompt',
      tagline: 'Windows Command Interpreter (cmd.exe)',
      meta: 'CLI · MS-DOS / WIN32',
      icon: '>_',
      source: 'IN-HOUSE',
      kind: 'system',
      multiple: true,
      launch: function (context, options) {
        if (typeof root.openShellWindow === 'function') {
          return root.openShellWindow('cmd', options);
        }
        if (typeof root.openTerminal === 'function') {
          return root.openTerminal(Object.assign({ dialect: 'cmd' }, options));
        }
        return null;
      }
    });
  }

  const CmdShellApp = Object.freeze({
    version: VERSION,
    ready: ready,
    banner: CMD_BANNER,
    createSession: createCmdSession
  });

  root.CmdShellApp = CmdShellApp;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CmdShellApp: CmdShellApp, createCmdSession: createCmdSession };
  }
})(typeof window !== 'undefined' ? window : global);
