/**
 * @file main/apps/powershell.js
 * @layer L6 (Application)
 * @owns  window.PowerShellApp
 * @needs [ 'CommandEngine', 'Kernel.syscall', 'AppRegistry' ]
 * @description
 * PowerShell (powershell.exe) L6 application.
 * Uses CommandEngine for parsing, pipes, redirection, and job control.
 * Provides PowerShell dialect:
 * - Cmdlets and common aliases (Get-ChildItem/dir/ls, Get-Content/type/cat,
 *   Set-Location/cd, Clear-Host/cls, Remove-Item/rm, Write-Output/echo, etc.)
 * - PS C:\...> prompt format.
 * - Environment variable access ($env:VAR).
 */

(function (root) {
  'use strict';

  const VERSION = '20261031';
  let readyResolve;
  const ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  const PS_BANNER = [
    'Windows PowerShell',
    'Copyright (C) Microsoft Corporation. All rights reserved.\n',
    'Try the new cross-platform PowerShell (https://aka.ms/pscore6)\n'
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

  function createPowerShellSession(options) {
    const opts = options || {};
    let cwd = opts.cwd || 'C:\\Users\\user';
    const env = Object.assign({
      PSVersion: '5.1.19041.1',
      PSHOME: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      USERNAME: (root.SiteConfig && root.SiteConfig.owner && root.SiteConfig.owner.displayName) || 'user'
    }, opts.env || {});

    const builtins = {};

    // Write-Output / echo
    builtins['write-output'] = builtins.echo = function (args) {
      return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
    };

    // Clear-Host / cls / clear
    builtins['clear-host'] = builtins.cls = builtins.clear = function () {
      return { stdout: '\x1b[2J\x1b[H', stderr: '', exitCode: 0, clearScreen: true };
    };

    // Set-Location / cd / sl
    builtins['set-location'] = builtins.cd = builtins.sl = async function (args, stdin, ctx) {
      const target = args[0];
      if (!target) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'powershell') : target;
      if (call) {
        try {
          const stat = await call(ctx, 'fs.stat', { path: resolved });
          if (stat && stat.type === 'directory') {
            cwd = resolved;
            return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
          }
        } catch (err) {
          return { stdout: '', stderr: `Set-Location : Cannot find path '${target}' because it does not exist.\n`, exitCode: 1 };
        }
      }
      cwd = resolved;
      return { stdout: '', stderr: '', exitCode: 0, newCwd: cwd };
    };

    // Get-Location / pwd / gl
    builtins['get-location'] = builtins.pwd = builtins.gl = function () {
      return {
        stdout: [
          'Path',
          '----',
          cwd + '\n'
        ].join('\n'),
        stderr: '',
        exitCode: 0
      };
    };

    // Get-ChildItem / dir / ls / gci
    builtins['get-childitem'] = builtins.dir = builtins.ls = builtins.gci = async function (args, stdin, ctx) {
      const target = args[0] || cwd;
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(target, cwd, 'powershell') : target;
      if (!call) {
        return { stdout: `Directory: ${resolved}\n(no filesystem available)\n`, stderr: '', exitCode: 0 };
      }
      try {
        const list = await call(ctx, 'fs.list', { path: resolved });
        let out = `\n    Directory: ${resolved}\n\n`;
        out += 'Mode                LastWriteTime         Length Name\n';
        out += '----                -------------         ------ ----\n';

        for (const item of list) {
          const isDir = item.type === 'directory';
          const mode = isDir ? 'd-----' : '-a----';
          const time = new Date(item.modifiedAt || item.createdAt || Date.now()).toLocaleDateString();
          const length = isDir ? '' : String(item.size || 0);
          out += `${mode.padEnd(20)}${time.padEnd(22)}${length.padEnd(7)} ${item.name}\n`;
        }
        return { stdout: out + '\n', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `Get-ChildItem : Cannot find path '${target}' because it does not exist.\n`, exitCode: 1 };
      }
    };

    // Get-Content / cat / type / gc
    builtins['get-content'] = builtins.cat = builtins.type = builtins.gc = async function (args, stdin, ctx) {
      if (!args[0]) {
        return { stdout: '', stderr: 'Get-Content : Cannot bind argument to parameter "Path" because it is null.\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'powershell') : args[0];
      try {
        const res = await call(ctx, 'fs.read', { path: resolved });
        const val = res && res.content ? (res.content.value !== undefined ? res.content.value : res.content) : '';
        return { stdout: val + (val.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `Get-Content : Cannot find path '${args[0]}' because it does not exist.\n`, exitCode: 1 };
      }
    };

    // Remove-Item / rm / del / rmdir / ri
    builtins['remove-item'] = builtins.rm = builtins.del = builtins.rmdir = builtins.ri = async function (args, stdin, ctx) {
      if (!args[0]) {
        return { stdout: '', stderr: 'Remove-Item : Cannot bind argument to parameter "Path" because it is null.\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'powershell') : args[0];
      try {
        await call(ctx, 'fs.remove', { path: resolved });
        return { stdout: '', stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `Remove-Item : Cannot find path '${args[0]}' because it does not exist.\n`, exitCode: 1 };
      }
    };

    // New-Item / ni / touch / md / mkdir
    builtins['new-item'] = builtins.ni = builtins.touch = builtins.md = builtins.mkdir = async function (args, stdin, ctx) {
      if (!args[0]) {
        return { stdout: '', stderr: 'New-Item : Missing path argument.\n', exitCode: 1 };
      }
      const call = getSyscall();
      const resolved = root.CommandEngine ? root.CommandEngine.resolvePath(args[0], cwd, 'powershell') : args[0];
      const isDir = args.includes('-ItemType') && args[args.indexOf('-ItemType') + 1] === 'Directory';
      try {
        await call(ctx, 'fs.write', { path: resolved, content: '', type: isDir ? 'directory' : 'file' });
        return { stdout: `    Directory: ${cwd}\nMode                Name\n----                ----\n${isDir ? 'd-----' : '-a----'}              ${args[0]}\n`, stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `New-Item : ${err.message || 'Item creation failed'}\n`, exitCode: 1 };
      }
    };

    // Get-Process / ps / gps
    builtins['get-process'] = builtins.ps = builtins.gps = async function (args, stdin, ctx) {
      const call = getSyscall();
      if (!call) return { stdout: 'NPM(K)    PM(M)      WS(M)     CPU(s)      Id  SI ProcessName\n', stderr: '', exitCode: 0 };
      try {
        const res = await call(ctx, 'proc.list');
        const list = res && Array.isArray(res) ? res : (res && res.value) || [];
        let out = 'Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id ProcessName\n';
        out += '-------  ------    -----      -----     ------     -- -----------\n';
        for (const p of list) {
          out += `     10       5     1024       2048       0.05   ${String(p.pid).padStart(4)} ${p.name || p.appId}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: 'Get-Process : Failed to query processes\n', exitCode: 1 };
      }
    };

    // Help / Get-Help
    builtins['get-help'] = builtins.help = function () {
      return {
        stdout: [
          'TOPIC',
          '    Windows PowerShell Help System\n',
          'COMMON CMDLETS & ALIASES',
          '    Get-ChildItem (dir, ls)  - Lists directory contents',
          '    Set-Location (cd, sl)    - Changes current directory',
          '    Get-Location (pwd, gl)   - Shows current directory path',
          '    Get-Content (cat, type)  - Displays content of a file',
          '    Remove-Item (rm, del)    - Deletes files or folders',
          '    New-Item (touch, ni)     - Creates new items',
          '    Get-Process (ps, gps)    - Lists processes',
          '    Clear-Host (clear, cls)  - Clears display',
          '    Write-Output (echo)      - Emits text to stdout',
          '    Exit                     - Closes the shell window\n'
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
      return `PS ${cwd}> `;
    }

    async function executeCommand(cmdline, executionCtx) {
      if (!root.CommandEngine) {
        return { stdout: '', stderr: 'CommandEngine not available\n', exitCode: 1 };
      }
      const ctx = Object.assign({
        cwd: cwd,
        env: env,
        dialect: 'powershell',
        builtins: builtins,
        uid: env.USERNAME || 'user',
        pid: (executionCtx && executionCtx.pid) || 2002
      }, executionCtx || {});

      const result = await root.CommandEngine.execute(cmdline, ctx);
      return result;
    }

    return {
      get banner() { return PS_BANNER; },
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
      id: 'powershell',
      name: 'PowerShell',
      tagline: 'Windows PowerShell Command Automation',
      meta: 'CLI · OBJECT PIPELINES',
      icon: '>_',
      source: 'IN-HOUSE',
      kind: 'system',
      multiple: true,
      launch: function (context, options) {
        if (typeof root.openShellWindow === 'function') {
          return root.openShellWindow('powershell', options);
        }
        if (typeof root.openTerminal === 'function') {
          return root.openTerminal(Object.assign({ dialect: 'powershell' }, options));
        }
        return null;
      }
    });
  }

  const PowerShellApp = Object.freeze({
    version: VERSION,
    ready: ready,
    banner: PS_BANNER,
    createSession: createPowerShellSession
  });

  root.PowerShellApp = PowerShellApp;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PowerShellApp: PowerShellApp, createPowerShellSession: createPowerShellSession };
  }
})(typeof window !== 'undefined' ? window : global);
