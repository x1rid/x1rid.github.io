#!/usr/bin/env node
/**
 * Zero-dependency unit tests for CommandEngine & Split Shells (Phase 2.4).
 * Run: node tests/command-engine.test.js
 */

'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { OsError, OsErrors } = require(path.join(ROOT, 'main/kernel/platform/errors.js'));
global.OsError = OsError;
global.OsErrors = OsErrors;

const { CommandEngine } = require(path.join(ROOT, 'main/shell/command-engine.js'));
global.CommandEngine = CommandEngine;

const { CmdShellApp, createCmdSession } = require(path.join(ROOT, 'main/apps/cmd.js'));
const { PowerShellApp, createPowerShellSession } = require(path.join(ROOT, 'main/apps/powershell.js'));
const { BashApp, createBashSession } = require(path.join(ROOT, 'main/apps/bash.js'));

let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    passed++;
    console.log('ok   ' + label);
  } else {
    failed++;
    console.log('FAIL ' + label);
  }
}

function equal(actual, expected, label) {
  ok(actual === expected, label + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// In-memory mock filesystem for tests
const mockFiles = new Map();

global.Kernel = {
  syscall: async function (ctx, name, args) {
    if (name === 'fs.stat') {
      const p = args.path;
      if (p === 'C:\\' || p === 'C:\\Users' || p === 'C:\\Users\\user' || p === '/' || p === '/home' || p === '/home/user') {
        return { ok: true, value: { id: 'dir-root', name: p, type: 'directory' } };
      }
      if (mockFiles.has(p)) {
        return { ok: true, value: { id: 'file-1', name: path.basename(p), type: 'file', size: mockFiles.get(p).length } };
      }
      throw new OsError('ENOENT', 'File not found', { path: p });
    }

    if (name === 'fs.list') {
      const items = [];
      for (const [k, v] of mockFiles.entries()) {
        items.push({ id: k, name: path.basename(k), type: 'file', size: v.length });
      }
      return { ok: true, value: items };
    }

    if (name === 'fs.read') {
      if (mockFiles.has(args.path)) {
        return { ok: true, value: { content: mockFiles.get(args.path) } };
      }
      throw new OsError('ENOENT', 'File not found', { path: args.path });
    }

    if (name === 'fs.write') {
      mockFiles.set(args.path, args.content || '');
      return { ok: true, value: { written: true, path: args.path } };
    }

    if (name === 'fs.remove') {
      mockFiles.delete(args.path);
      return { ok: true, value: { removed: true, path: args.path } };
    }

    if (name === 'proc.list') {
      return { ok: true, value: [{ pid: 1, name: 'init' }, { pid: 1042, name: 'terminal' }] };
    }

    return { ok: true, value: null };
  }
};

async function runTests() {
  console.log('--- Phase 2.4: CommandEngine & Split Shells Tests ---');

  // ── 1. Tokenizer & Parser ────────────────────────────────────────────────
  const tokens = CommandEngine.tokenize('echo "hello world" | grep hello > out.txt &');
  equal(tokens.length, 8, 'Token count matches expected');
  equal(tokens[0].type, 'WORD', 'First token is WORD');
  equal(tokens[0].value, 'echo', 'First token value is echo');
  equal(tokens[1].value, 'hello world', 'Quoted string extracted without quotes');
  equal(tokens[2].type, 'PIPE', 'Pipe token parsed');
  equal(tokens[3].value, 'grep', 'grep argument parsed');
  equal(tokens[4].value, 'hello', 'hello argument parsed');
  equal(tokens[5].type, 'REDIRECT_OUT', 'Redirect out token parsed');
  equal(tokens[7].type, 'BG', 'Background & token parsed');

  const ast = CommandEngine.parse('echo first && echo second | cat > result.txt ; echo third &');
  equal(ast.length, 3, 'Pipeline count is 3');
  equal(ast[0].nextOp, '&&', 'First pipeline connects with &&');
  equal(ast[1].commands.length, 2, 'Second pipeline has 2 commands chained by pipe');
  equal(ast[1].commands[1].redirects.length, 1, 'Pipe destination command has redirection');
  equal(ast[2].background, true, 'Third pipeline marked as background');

  // ── 2. Environment Variable Expansion ────────────────────────────────────
  const env = { USER: 'alice', WINDIR: 'C:\\WINDOWS', GREETING: 'Hello' };
  equal(CommandEngine.expandEnv('$USER', env), 'alice', 'POSIX $VAR expanded');
  equal(CommandEngine.expandEnv('${USER}_test', env), 'alice_test', 'POSIX ${VAR} expanded');
  equal(CommandEngine.expandEnv('%WINDIR%\\System32', env), 'C:\\WINDOWS\\System32', 'Windows %VAR% expanded');
  equal(CommandEngine.expandEnv('%windir%', env), 'C:\\WINDOWS', 'Windows case-insensitive %var% expanded');
  equal(CommandEngine.expandEnv('$env:USER', env), 'alice', 'PowerShell $env:VAR expanded');

  // ── 3. Pipeline & Redirection Execution ──────────────────────────────────
  mockFiles.clear();
  const execCtx = {
    cwd: '/home/user',
    env: { USER: 'user' },
    dialect: 'bash',
    builtins: {
      echo: function (args) {
        return { stdout: args.join(' ') + '\n', stderr: '', exitCode: 0 };
      },
      cat: async function (args, stdin, ctx) {
        if (!args[0]) return { stdout: stdin, stderr: '', exitCode: 0 };
        const data = await ctx.callFs('fs.read', { path: args[0] });
        return { stdout: data.content, stderr: '', exitCode: 0 };
      },
      uppercase: function (args, stdin) {
        return { stdout: (stdin || '').toUpperCase(), stderr: '', exitCode: 0 };
      }
    }
  };

  // Execution: echo to file redirection
  const res1 = await CommandEngine.execute('echo "hi world" > greeting.txt', execCtx);
  equal(res1.exitCode, 0, 'Redirection execution succeeds');
  ok(mockFiles.has('/home/user/greeting.txt'), 'File created in mock VFS');
  equal(mockFiles.get('/home/user/greeting.txt').trim(), 'hi world', 'File contains redirected text');

  // Execution: pipe chaining (echo | uppercase)
  const res2 = await CommandEngine.execute('echo hello | uppercase', execCtx);
  equal(res2.exitCode, 0, 'Pipeline execution succeeds');
  equal(res2.stdout.trim(), 'HELLO', 'Pipeline piped stdout to stdin of second command');

  // Execution: append redirection (>>)
  await CommandEngine.execute('echo appended >> greeting.txt', execCtx);
  const content = mockFiles.get('/home/user/greeting.txt');
  ok(content.includes('hi world') && content.includes('appended'), 'Append redirection appends content');

  // ── 4. Job Control ───────────────────────────────────────────────────────
  const job = CommandEngine.jobControl.createJob('sleep 10', 9999);
  ok(job !== null, 'Job created');
  equal(job.status, 'running', 'Job starts in running status');
  equal(CommandEngine.jobControl.getJob(job.id).pid, 9999, 'Job query returns correct job');

  const killRes = await CommandEngine.execute(`kill %${job.id}`, execCtx);
  equal(killRes.exitCode, 0, 'Kill job succeeds');
  equal(CommandEngine.jobControl.getJob(job.id), null, 'Terminated job removed from active table');

  // ── 5. CMD Shell App Dialect ─────────────────────────────────────────────
  const cmd = createCmdSession({ cwd: 'C:\\Users\\user' });
  ok(cmd.banner.includes('Microsoft Windows 98'), 'CMD banner present');
  equal(cmd.prompt, 'C:\\Users\\user>', 'CMD prompt formatted as C:\\...>');

  const cmdEcho = await cmd.execute('echo Hello CMD');
  equal(cmdEcho.stdout.trim(), 'Hello CMD', 'CMD echo builtin works');

  const cmdVer = await cmd.execute('ver');
  ok(cmdVer.stdout.includes('Windows 98'), 'CMD ver builtin returns version');

  // ── 6. PowerShell Shell App Dialect ──────────────────────────────────────
  const ps = createPowerShellSession({ cwd: 'C:\\Users\\user' });
  ok(ps.banner.includes('Windows PowerShell'), 'PowerShell banner present');
  equal(ps.prompt, 'PS C:\\Users\\user> ', 'PowerShell prompt formatted as PS C:\\...>');

  const psEcho = await ps.execute('Write-Output "PowerShell Test"');
  equal(psEcho.stdout.trim(), 'PowerShell Test', 'PowerShell Write-Output works');

  const psAlias = await ps.execute('echo alias_test');
  equal(psAlias.stdout.trim(), 'alias_test', 'PowerShell echo alias works');

  // ── 7. Bash Shell App Dialect ────────────────────────────────────────────
  const bash = createBashSession({ cwd: '/home/user' });
  ok(bash.banner.includes('GNU bash'), 'Bash banner present');
  equal(bash.prompt, 'user@desktop:~$ ', 'Bash prompt formatted with ~ for home');

  const bashPwd = await bash.execute('pwd');
  equal(bashPwd.stdout.trim(), '/home/user', 'Bash pwd builtin works');

  const bashExport = await bash.execute('export TEST_VAR=123');
  equal(bashExport.exitCode, 0, 'Bash export succeeds');
  equal(bash.env.TEST_VAR, '123', 'Bash env updated with exported var');

  const bashExpand = await bash.execute('echo $TEST_VAR');
  equal(bashExpand.stdout.trim(), '123', 'Bash expanded newly exported variable');

  // ── 8. Diagnostics ───────────────────────────────────────────────────────
  const diag = CommandEngine.diagnostics();
  ok(diag.totalCommandsExecuted > 0, 'Diagnostics reports executed commands');
  ok(diag.totalPipelinesExecuted > 0, 'Diagnostics reports executed pipelines');
  ok(diag.totalRedirectionsExecuted > 0, 'Diagnostics reports executed redirections');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(function (err) {
  console.error('Test execution failed:', err);
  process.exit(1);
});
