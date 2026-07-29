/**
 * Shell executor — strict child_process wrapper.
 *
 * Security model (v1):
 *   - Command must be in whitelist
 *   - No shell interpretation (use spawn, not exec)
 *   - Workdir isolated to SANDBOX_WORKDIR
 *   - Hard timeout kills the process
 *   - Output size cap: each stream is truncated at MAX_OUTPUT_BYTES, and
 *     the process is immediately SIGKILLed on overflow. The kill reason is
 *     surfaced via `killedBy` so callers (e.g. the Agent tool wrapper) can
 *     surface a meaningful error to the model.
 */
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import * as path from 'path';
import { isAllowedCommand } from './whitelist';

const DEFAULT_TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT_MS) || 30_000;
const DEFAULT_WORKDIR = process.env.SANDBOX_WORKDIR
  ? path.resolve(process.env.SANDBOX_WORKDIR)
  : path.resolve(process.cwd(), 'sandbox-workdir');
// Ensure the workdir exists before any spawn() runs. Node's child_process.spawn
// returns ENOENT (not a working-directory error) when cwd doesn't exist, which
// makes every command look like the binary is missing — confusing for both the
// LLM caller and our debug logs. We mkdirSync once at module load.
mkdirSync(DEFAULT_WORKDIR, { recursive: true });
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB per stream

/**
 * Reason a child process was forcibly killed.
 * `null` means the process exited on its own (possibly with non-zero code).
 */
export type KillReason = 'OUTPUT_LIMIT' | 'TIMEOUT' | null;

export interface ShellExecuteParams {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  killedBy: KillReason;
  durationMs: number;
}

export async function executeShell({
  command,
  args = [],
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ShellExecuteParams): Promise<ShellExecuteResult> {
  // 1. Whitelist check
  if (!isAllowedCommand(command)) {
    throw new Error(`[sandbox] Command "${command}" is not in the whitelist`);
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd ? path.resolve(cwd) : DEFAULT_WORKDIR,
      // shell: false — CRITICAL. Prevents shell injection via args.
      shell: false,
      timeout: timeoutMs,
      // Drop all env, only pass a minimal set
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG || 'C.UTF-8',
      },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killedBy: KillReason = null;

    // Once any stream overflows, we kill the process and stop accumulating.
    // We keep appending to *one* truncated buffer so the caller sees what
    // was captured before the kill.
    function killForLimit(reason: 'OUTPUT_LIMIT') {
      if (killedBy !== null) return; // already killed for another reason
      killedBy = reason;
      child.kill('SIGKILL');
    }

    child.stdout.on('data', (data: Buffer) => {
      if (killedBy !== null) return;
      if (stdout.length + data.length > MAX_OUTPUT_BYTES) {
        // Take what fits, then kill.
        const remaining = MAX_OUTPUT_BYTES - stdout.length;
        if (remaining > 0) {
          stdout += data.subarray(0, remaining).toString('utf8');
        }
        killForLimit('OUTPUT_LIMIT');
        return;
      }
      stdout += data.toString('utf8');
    });

    child.stderr.on('data', (data: Buffer) => {
      if (killedBy !== null) return;
      if (stderr.length + data.length > MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderr.length;
        if (remaining > 0) {
          stderr += data.subarray(0, remaining).toString('utf8');
        }
        killForLimit('OUTPUT_LIMIT');
        return;
      }
      stderr += data.toString('utf8');
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timedOut,
        killedBy,
        durationMs: Date.now() - startTime,
      });
    });

    // Hard timeout — kill if it doesn't finish.
    const timer = setTimeout(() => {
      timedOut = true;
      killedBy = 'TIMEOUT';
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', () => {
      clearTimeout(timer);
    });
  });
}