/**
 * LangChain tools wrapping the sandbox executor.
 *
 * LangChain 1.x style: use the `tool()` factory from "langchain" with zod 4 schema.
 * The tool factory handles type inference and integration with the agent harness.
 *
 * Tool result semantics:
 *   - On success: returns the captured stdout (or stderr if stdout is empty)
 *   - On killed-by-output-limit: returns a clear error explaining the cap
 *     and the partial output, so the Agent can adjust (e.g. switch to
 *     read_file with maxLines, or pipe through head/grep)
 *   - On killed-by-timeout: returns a clear timeout error
 *   - On non-zero exit: returns the exit code + captured streams
 */
import { tool } from 'langchain';
import * as z from 'zod';
import { executeShell } from './shell-executor';
import type { ShellExecuteResult } from './shell-executor';

/**
 * Convert a ShellExecuteResult into a tool return string with rich error
 * context. Returns stdout directly on success, or a structured error block.
 */
function formatShellResult(result: ShellExecuteResult): string {
  if (result.killedBy === 'OUTPUT_LIMIT') {
    return [
      `[ERROR] Output exceeded 1MB cap; process was killed (SIGKILL) at ${result.durationMs}ms.`,
      `Partial stdout (${result.stdout.length} bytes captured before kill):`,
      result.stdout,
      ``,
      `Hint: pipe through head/tail/grep, or use the read_file tool with a maxLines argument.`,
    ].join('\n');
  }
  if (result.killedBy === 'TIMEOUT') {
    return `[ERROR] Command timed out after ${result.durationMs}ms (killed via SIGKILL). Partial stdout:\n${result.stdout}`;
  }
  if (result.exitCode !== 0) {
    return `[ERROR] exit code ${result.exitCode}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
  }
  return result.stdout || '(no output)';
}

export const runShellTool = tool(
  async (input) => {
    const { command, args = [] } = input;
    const result = await executeShell({ command, args });
    return formatShellResult(result);
  },
  {
    name: 'run_shell',
    description:
      'Execute a whitelisted shell command in an isolated sandbox. Returns stdout. ' +
      'The command must be in the whitelist. Output is capped at 1MB — for large ' +
      'files use read_file with maxLines, or pipe through head/tail/grep.',
    schema: z.object({
      command: z
        .string()
        .describe('The command to execute (must be in whitelist, e.g. "ls", "cat", "grep")'),
      args: z
        .array(z.string())
        .optional()
        .describe('Arguments to pass to the command. Each arg is a separate string.'),
    }),
  },
);

export const listDirectoryTool = tool(
  async (input) => {
    const { path: dirPath } = input;
    const result = await executeShell({
      command: 'ls',
      args: ['-la', dirPath],
    });
    return formatShellResult(result);
  },
  {
    name: 'list_directory',
    description: 'List files in a directory with details. Read-only operation.',
    schema: z.object({
      path: z.string().describe('Directory path to list'),
    }),
  },
);

export const readFileTool = tool(
  async (input) => {
    const { path: filePath, maxLines } = input;
    const args = maxLines ? ['-n', String(maxLines), filePath] : [filePath];
    const result = await executeShell({
      command: 'cat',
      args,
    });
    return formatShellResult(result);
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file, capped to maxLines if provided. ' +
      'Prefer this over `cat` via run_shell for any non-trivial file size.',
    schema: z.object({
      path: z.string().describe('Path to the file to read'),
      maxLines: z.number().optional().describe('Maximum number of lines to read'),
    }),
  },
);

export const sandboxTools = [runShellTool, listDirectoryTool, readFileTool];