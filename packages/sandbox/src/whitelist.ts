/**
 * Whitelist of commands the Agent is allowed to execute via the sandbox.
 *
 * Adding a command here is a security decision — only add what's truly needed.
 * Each command is run with explicit args (no shell interpretation) to prevent injection.
 */
export const ALLOWED_COMMANDS = [
  // File inspection (read-only)
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',

  // Text processing
  'grep',
  'sed',
  'awk',
  'cut',
  'sort',
  'uniq',
  'tr',
  'jq',

  // Search
  'find',

  // Network (read-only)
  'curl',
  'wget',

  // System info
  'uname',
  'whoami',
  'pwd',
  'date',
  'echo',

  // Archive (read-only)
  'tar',
  'unzip',

  // Process inspection
  'ps',
  'top',
  'df',
  'du',
  'free',

  // Misc
  'tree',
  'diff',
  'md5sum',
  'sha256sum',
] as const;

export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

export function isAllowedCommand(cmd: string): cmd is AllowedCommand {
  return (ALLOWED_COMMANDS as readonly string[]).includes(cmd);
}