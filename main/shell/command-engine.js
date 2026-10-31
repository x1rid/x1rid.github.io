/**
 * @file main/shell/command-engine.js
 * @layer L5/L6 shared library
 * @owns  window.CommandEngine
 * @needs [ 'Kernel.syscall', 'KernelPlatform.errors' ]
 * @description
 * Command engine library shared across L6 shells (cmd, powershell, bash).
 * Provides command line tokenization, AST parsing (pipes, redirections, sequences,
 * background jobs), environment variable expansion, pipeline execution,
 * job control, and filesystem I/O through Kernel.syscall.
 */

(function (root) {
  'use strict';

  const VERSION = '20261031';
  let readyResolve;
  const ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  // Diagnostics counters
  let totalCommandsExecuted = 0;
  let totalPipelinesExecuted = 0;
  let totalRedirectionsExecuted = 0;
  let nextJobId = 1;

  // Active simulated jobs map: jobId -> JobRecord
  const activeJobs = new Map();

  function getOsError(code, message, detail) {
    const Ctor = root.OsError || Error;
    const err = Ctor === Error ? new Error(message || code) : new Ctor(code, message, detail);
    err.name = 'OsError';
    err.code = code;
    if (detail !== undefined) err.detail = detail;
    return err;
  }

  /* -------------------------------------------------------------------------
   * 1. Tokenizer & Parser
   * ------------------------------------------------------------------------- */

  /**
   * Token types:
   * 'WORD' | 'PIPE' (|) | 'REDIRECT_OUT' (>) | 'REDIRECT_APPEND' (>>) |
   * 'REDIRECT_IN' (<) | 'AND' (&&) | 'OR' (||) | 'SEMI' (;) | 'BG' (&)
   */
  function tokenize(input) {
    const tokens = [];
    let i = 0;
    const str = String(input || '').trim();
    const len = str.length;

    while (i < len) {
      const c = str[i];

      // Whitespace
      if (/\s/.test(c)) {
        i++;
        continue;
      }

      // Operators
      if (c === '&') {
        if (str[i + 1] === '&') {
          tokens.push({ type: 'AND', value: '&&' });
          i += 2;
        } else {
          tokens.push({ type: 'BG', value: '&' });
          i++;
        }
        continue;
      }

      if (c === '|') {
        if (str[i + 1] === '|') {
          tokens.push({ type: 'OR', value: '||' });
          i += 2;
        } else {
          tokens.push({ type: 'PIPE', value: '|' });
          i++;
        }
        continue;
      }

      if (c === ';') {
        tokens.push({ type: 'SEMI', value: ';' });
        i++;
        continue;
      }

      if (c === '>') {
        if (str[i + 1] === '>') {
          tokens.push({ type: 'REDIRECT_APPEND', value: '>>' });
          i += 2;
        } else {
          tokens.push({ type: 'REDIRECT_OUT', value: '>' });
          i++;
        }
        continue;
      }

      if (c === '<') {
        tokens.push({ type: 'REDIRECT_IN', value: '<' });
        i++;
        continue;
      }

      // Quoted string or normal word
      let word = '';
      let inQuote = null;

      while (i < len) {
        const ch = str[i];

        if (inQuote) {
          if (ch === '\\' && i + 1 < len && inQuote === '"') {
            word += str[i + 1];
            i += 2;
            continue;
          }
          if (ch === inQuote) {
            inQuote = null;
            i++;
            continue;
          }
          word += ch;
          i++;
          continue;
        }

        if (ch === '"' || ch === "'") {
          inQuote = ch;
          i++;
          continue;
        }

        if (ch === '\\' && i + 1 < len) {
          word += str[i + 1];
          i += 2;
          continue;
        }

        if (/[\s;|&><]/.test(ch)) {
          break;
        }

        word += ch;
        i++;
      }

      tokens.push({ type: 'WORD', value: word });
    }

    return tokens;
  }

  /**
   * Parses token stream into a list of Pipeline command objects:
   * [
   *   {
   *     commands: [
   *       { args: ['echo', 'hi'], redirects: [{ type: '>', target: 'a.txt' }] },
   *       { args: ['grep', 'h'], redirects: [] }
   *     ],
   *     background: false,
   *     nextOp: ';' | '&&' | '||' | null
   *   }
   * ]
   */
  function parse(input) {
    const tokens = tokenize(input);
    const pipelines = [];
    let currentPipeline = { commands: [], background: false, nextOp: null };
    let currentCmd = { args: [], redirects: [] };

    function pushCmd() {
      if (currentCmd.args.length > 0 || currentCmd.redirects.length > 0) {
        currentPipeline.commands.push(currentCmd);
        currentCmd = { args: [], redirects: [] };
      }
    }

    function pushPipeline(op, bg) {
      pushCmd();
      if (currentPipeline.commands.length > 0) {
        currentPipeline.background = Boolean(bg);
        currentPipeline.nextOp = op || null;
        pipelines.push(currentPipeline);
        currentPipeline = { commands: [], background: false, nextOp: null };
      }
    }

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];

      if (tok.type === 'WORD') {
        currentCmd.args.push(tok.value);
        i++;
      } else if (tok.type === 'PIPE') {
        pushCmd();
        i++;
      } else if (tok.type === 'REDIRECT_OUT' || tok.type === 'REDIRECT_APPEND' || tok.type === 'REDIRECT_IN') {
        const nextTok = tokens[i + 1];
        const target = nextTok && nextTok.type === 'WORD' ? nextTok.value : '';
        currentCmd.redirects.push({
          type: tok.value,
          target: target
        });
        i += nextTok && nextTok.type === 'WORD' ? 2 : 1;
      } else if (tok.type === 'SEMI') {
        pushPipeline(';', false);
        i++;
      } else if (tok.type === 'AND') {
        pushPipeline('&&', false);
        i++;
      } else if (tok.type === 'OR') {
        pushPipeline('||', false);
        i++;
      } else if (tok.type === 'BG') {
        pushPipeline(';', true);
        i++;
      } else {
        i++;
      }
    }

    pushPipeline(null, false);
    return pipelines;
  }

  /* -------------------------------------------------------------------------
   * 2. Environment Variable Expansion
   * ------------------------------------------------------------------------- */

  /**
   * Expands $VAR, ${VAR}, and %VAR% using given env mapping.
   */
  function expandEnv(str, env) {
    if (!str || typeof str !== 'string') return '';
    const map = env || {};

    // 1. Expand Windows style: %NAME%
    let res = str.replace(/%([A-Za-z0-9_]+)%/g, function (match, name) {
      // Case-insensitive lookup for windows env keys
      const upper = name.toUpperCase();
      for (const k of Object.keys(map)) {
        if (k.toUpperCase() === upper) {
          return map[k] !== undefined ? map[k] : '';
        }
      }
      return match;
    });

    // 2. Expand PowerShell style: $env:NAME
    res = res.replace(/\$env:([A-Za-z0-9_]+)/gi, function (match, name) {
      const upper = name.toUpperCase();
      for (const k of Object.keys(map)) {
        if (k.toUpperCase() === upper) {
          return map[k] !== undefined ? map[k] : '';
        }
      }
      return '';
    });

    // 3. Expand POSIX style: ${NAME} and $NAME
    res = res.replace(/\$\{([A-Za-z0-9_]+)\}/g, function (match, name) {
      return map[name] !== undefined ? map[name] : '';
    });

    res = res.replace(/\$([A-Za-z0-9_]+)/g, function (match, name) {
      return map[name] !== undefined ? map[name] : '';
    });

    return res;
  }

  /* -------------------------------------------------------------------------
   * 3. Syscall Helpers
   * ------------------------------------------------------------------------- */

  function getSyscall() {
    if (root.Kernel && typeof root.Kernel.syscall === 'function') {
      return root.Kernel.syscall.bind(root.Kernel);
    }
    if (root.KernelSyscalls && typeof root.KernelSyscalls.syscall === 'function') {
      return root.KernelSyscalls.syscall.bind(root.KernelSyscalls);
    }
    return null;
  }

  async function callFs(ctx, name, args) {
    const syscall = getSyscall();
    if (!syscall) {
      throw getOsError('EBUSY', 'Syscall layer unavailable', { name });
    }
    const res = await syscall(ctx, name, args);
    if (res && typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'ok')) {
      if (!res.ok) {
        throw getOsError(res.error || 'EINVAL', res.message || 'Syscall failed', args);
      }
      return res.value;
    }
    return res;
  }

  /* -------------------------------------------------------------------------
   * 4. Job Control
   * ------------------------------------------------------------------------- */

  function createJob(cmdline, pid) {
    const id = nextJobId++;
    const job = {
      id: id,
      pid: pid || 1000 + id,
      cmdline: cmdline,
      status: 'running', // 'running' | 'done' | 'stopped'
      startedAt: Date.now()
    };
    activeJobs.set(id, job);
    return job;
  }

  function getJobs() {
    return Array.from(activeJobs.values());
  }

  function getJob(id) {
    return activeJobs.get(Number(id)) || null;
  }

  function removeJob(id) {
    return activeJobs.delete(Number(id));
  }

  /* -------------------------------------------------------------------------
   * 5. Pipeline Execution Engine
   * ------------------------------------------------------------------------- */

  /**
   * Execution Context:
   * {
   *   cwd: string,
   *   env: Object,
   *   uid: string,
   *   pid: number,
   *   caps: string[],
   *   dialect: 'cmd' | 'powershell' | 'bash',
   *   builtins: Map or Object of functions (args, stdin, ctx) => Promise<{ stdout, stderr, exitCode }>
   * }
   */
  async function execute(commandString, shellContext) {
    totalCommandsExecuted++;
    const pipelines = parse(commandString);
    const env = shellContext.env || {};
    let lastExitCode = 0;
    const allOutputs = [];

    for (const pipeline of pipelines) {
      // Evaluate conditional operators: && or ||
      // (checked before executing the next pipeline)
      totalPipelinesExecuted++;

      if (pipeline.background) {
        // Run as background job
        const job = createJob(commandString, shellContext.pid);
        const bgPromise = runPipeline(pipeline, shellContext, env);
        bgPromise
          .then(function (res) {
            job.status = 'done';
            job.result = res;
          })
          .catch(function (err) {
            job.status = 'done';
            job.error = err;
          });

        allOutputs.push({
          stdout: `[${job.id}] ${job.pid}\n`,
          stderr: '',
          exitCode: 0,
          jobId: job.id
        });
        continue;
      }

      const res = await runPipeline(pipeline, shellContext, env);
      lastExitCode = res.exitCode;
      allOutputs.push(res);

      if (pipeline.nextOp === '&&' && lastExitCode !== 0) {
        break;
      }
      if (pipeline.nextOp === '||' && lastExitCode === 0) {
        break;
      }
    }

    return {
      exitCode: lastExitCode,
      stdout: allOutputs.map(o => o.stdout || '').join(''),
      stderr: allOutputs.map(o => o.stderr || '').join('')
    };
  }

  async function runPipeline(pipeline, shellContext, env) {
    let currentInput = '';
    let lastResult = { stdout: '', stderr: '', exitCode: 0 };

    for (let i = 0; i < pipeline.commands.length; i++) {
      const cmdDef = pipeline.commands[i];
      const expandedArgs = cmdDef.args.map(a => expandEnv(a, env));

      // Handle input redirection (< file)
      for (const redir of cmdDef.redirects) {
        if (redir.type === '<') {
          totalRedirectionsExecuted++;
          const filePath = resolvePath(redir.target, shellContext.cwd, shellContext.dialect);
          try {
            const data = await callFs(shellContext, 'fs.read', { path: filePath });
            currentInput = data && data.content ? (data.content.value !== undefined ? data.content.value : data.content) : '';
          } catch (err) {
            return {
              stdout: '',
              stderr: `${redir.target}: ${err.message || 'No such file or directory'}\n`,
              exitCode: 1
            };
          }
        }
      }

      // Execute command or builtin
      lastResult = await runSingleCommand(expandedArgs, currentInput, shellContext);

      // Handle output redirection (> file, >> file)
      for (const redir of cmdDef.redirects) {
        if (redir.type === '>' || redir.type === '>>') {
          totalRedirectionsExecuted++;
          const filePath = resolvePath(redir.target, shellContext.cwd, shellContext.dialect);
          const isAppend = redir.type === '>>';
          let writeContent = lastResult.stdout;

          try {
            if (isAppend) {
              let existing = '';
              try {
                const readRes = await callFs(shellContext, 'fs.read', { path: filePath });
                existing = readRes && readRes.content ? (readRes.content.value !== undefined ? readRes.content.value : readRes.content) : '';
              } catch (e) {
                // file might not exist yet; ok
              }
              writeContent = existing + writeContent;
            }

            await callFs(shellContext, 'fs.write', { path: filePath, content: writeContent });
            // Redirection swallows stdout to terminal
            lastResult.stdout = '';
          } catch (err) {
            lastResult.stderr += `${redir.target}: ${err.message || 'Cannot write to file'}\n`;
            lastResult.exitCode = 1;
          }
        }
      }

      // Output of this command becomes input to the next in pipeline
      currentInput = lastResult.stdout;
    }

    return lastResult;
  }

  async function runSingleCommand(args, stdin, shellContext) {
    if (!args || args.length === 0) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const cmdName = args[0];
    const cmdArgs = args.slice(1);
    const dialect = shellContext.dialect || 'bash';

    // 1. Check dialect-specific or shell-provided builtins
    const builtins = shellContext.builtins || {};
    let handler = null;

    if (typeof builtins.get === 'function') {
      handler = builtins.get(cmdName) || (dialect === 'cmd' ? builtins.get(cmdName.toLowerCase()) : null);
    } else if (typeof builtins === 'object') {
      if (builtins[cmdName]) {
        handler = builtins[cmdName];
      } else if (dialect === 'cmd' || dialect === 'powershell') {
        const lower = cmdName.toLowerCase();
        for (const k of Object.keys(builtins)) {
          if (k.toLowerCase() === lower) {
            handler = builtins[k];
            break;
          }
        }
      }
    }

    if (typeof handler === 'function') {
      try {
        const res = await handler(cmdArgs, stdin, shellContext);
        if (res && typeof res === 'object') {
          return {
            stdout: res.stdout !== undefined ? String(res.stdout) : '',
            stderr: res.stderr !== undefined ? String(res.stderr) : '',
            exitCode: res.exitCode !== undefined ? Number(res.exitCode) : 0
          };
        }
        return { stdout: String(res || ''), stderr: '', exitCode: 0 };
      } catch (err) {
        return { stdout: '', stderr: `${cmdName}: ${err.message || 'execution failed'}\n`, exitCode: 1 };
      }
    }

    // 2. Fallback common built-ins
    if (cmdName === 'jobs') {
      const jobList = getJobs();
      let out = '';
      for (const j of jobList) {
        out += `[${j.id}] ${j.status.padEnd(8)} ${j.cmdline}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    }

    if (cmdName === 'kill') {
      const target = cmdArgs[0];
      if (!target) {
        return { stdout: '', stderr: 'kill: usage: kill <pid|%job>\n', exitCode: 1 };
      }
      if (target.startsWith('%')) {
        const jid = Number(target.slice(1));
        const j = getJob(jid);
        if (j) {
          j.status = 'stopped';
          removeJob(jid);
          return { stdout: `[${jid}] Terminated\n`, stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: `kill: ${target}: no such job\n`, exitCode: 1 };
      }
      // PID kill
      for (const j of activeJobs.values()) {
        if (String(j.pid) === String(target)) {
          j.status = 'stopped';
          removeJob(j.id);
          return { stdout: `Terminated ${target}\n`, stderr: '', exitCode: 0 };
        }
      }
      return { stdout: '', stderr: `kill: (${target}) - No such process\n`, exitCode: 1 };
    }

    // Command not found
    const notFoundMsg = dialect === 'cmd'
      ? `'${cmdName}' is not recognized as an internal or external command, operable program or batch file.\n`
      : (dialect === 'powershell'
        ? `${cmdName} : The term '${cmdName}' is not recognized as the name of a cmdlet, function, script file, or operable program.\n`
        : `${cmdName}: command not found\n`);

    return { stdout: '', stderr: notFoundMsg, exitCode: 127 };
  }

  function resolvePath(target, cwd, dialect) {
    if (!target) return cwd || (dialect === 'cmd' || dialect === 'powershell' ? 'C:\\' : '/');
    const isWin = dialect === 'cmd' || dialect === 'powershell';

    if (isWin) {
      if (/^[A-Za-z]:[\\/]/.test(target)) {
        return target.replace(/\//g, '\\');
      }
      const base = (cwd || 'C:\\').replace(/\/+$/, '');
      const rel = target.replace(/\//g, '\\').replace(/^\\+/, '');
      return base.endsWith('\\') ? base + rel : base + '\\' + rel;
    }

    // Posix
    if (target.startsWith('/')) {
      return target;
    }
    const base = (cwd || '/').replace(/\/+$/, '');
    return base === '' ? '/' + target : base + '/' + target;
  }

  /* -------------------------------------------------------------------------
   * Export Frozen Service
   * ------------------------------------------------------------------------- */

  const CommandEngine = Object.freeze({
    version: VERSION,
    ready: ready,
    tokenize: tokenize,
    parse: parse,
    expandEnv: expandEnv,
    execute: execute,
    resolvePath: resolvePath,
    jobControl: Object.freeze({
      createJob: createJob,
      getJobs: getJobs,
      getJob: getJob,
      removeJob: removeJob
    }),
    diagnostics: function () {
      return {
        version: VERSION,
        totalCommandsExecuted: totalCommandsExecuted,
        totalPipelinesExecuted: totalPipelinesExecuted,
        totalRedirectionsExecuted: totalRedirectionsExecuted,
        activeJobsCount: activeJobs.size
      };
    }
  });

  root.CommandEngine = CommandEngine;
  readyResolve();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CommandEngine: CommandEngine };
  }
})(typeof window !== 'undefined' ? window : global);
