import {readdir, readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';

/** Where `bin/ghpr-claude-state` records each Claude Code session's state, one file per project folder. */
export const CLAUDE_STATE_DIR = join(homedir(), '.cache', 'ghpr', 'claude');

export type ClaudeState = 'working' | 'waiting' | 'permission';

const STATES = new Set<string>(['working', 'waiting', 'permission']);

/** The state file name for a project folder: its path with every `/` as `%`. */
export const stateFileName = (dir: string) => dir.replaceAll('/', '%');

/** The recorded state of every Claude Code session by project folder. Never rejects. */
export async function readClaudeStates(root = CLAUDE_STATE_DIR): Promise<Map<string, ClaudeState>> {
	const names = await readdir(root).catch(() => []);
	const entries = await Promise.all(
		names.map(async name => {
			const state = (await readFile(join(root, name), 'utf8').catch(() => '')).trim();
			return STATES.has(state) ? [[name.replaceAll('%', '/'), state as ClaudeState] as const] : [];
		}),
	);
	return new Map(entries.flat());
}
