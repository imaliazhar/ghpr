import {execFile} from 'node:child_process';
import {rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import {CLAUDE_STATE_DIR, stateFileName} from './claudeState.js';
import type {Checkout} from './checkouts.js';
import {sessionName} from './tmux.js';

const exec = promisify(execFile);

/** What `cleanUpWorkspace` needs from git, tmux and the file system. */
export type CleanupEnv = {
	git: (cwd: string, args: string[]) => Promise<string>;
	tmux: (args: string[]) => Promise<string>;
	/** The tmux session ghpr runs in, if any. */
	ownSession: () => Promise<string | null>;
	removeFile: (path: string) => Promise<void>;
};

const defaultEnv: CleanupEnv = {
	git: async (cwd, args) => (await exec('git', args, {cwd})).stdout.trim(),
	tmux: async args => (await exec('tmux', args)).stdout.trim(),
	ownSession: async () =>
		process.env.TMUX ? (await exec('tmux', ['display-message', '-p', '#{session_name}']).catch(() => null))?.stdout.trim() ?? null : null,
	removeFile: path => rm(path, {force: true}),
};

const succeeds = (promise: Promise<unknown>) => promise.then(() => true, () => false);
const shortDir = (dir: string) => dir.replace(homedir(), '~');

/**
 * Cleans up the local workspace of a merged PR: closes its tmux session (unless ghpr runs in it), removes
 * it when it's a worktree or switches it back to the default branch when it's a clone, deletes the
 * branch, and forgets its claude state. `headSha` is the merged PR's head commit.
 *
 * Refuses, before changing anything, when the workspace has uncommitted changes or the branch has
 * commits that aren't in the PR. Returns what it did, in order.
 */
export async function cleanUpWorkspace(checkout: Checkout, headSha: string, env: CleanupEnv = defaultEnv): Promise<string[]> {
	const {dir, branch} = checkout;
	const git = (args: string[], cwd = dir) => env.git(cwd, args);

	if (await git(['status', '--porcelain'])) throw new Error(`${shortDir(dir)} has uncommitted changes`);
	const inPr = () => succeeds(git(['merge-base', '--is-ancestor', branch, headSha]));
	if (!(await inPr()) && !((await succeeds(git(['fetch', 'origin', headSha]))) && (await inPr()))) {
		throw new Error(`${branch} has commits that aren't in the merged PR`);
	}
	const [gitDir, commonDir] = (await git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])).split('\n');
	const isWorktree = gitDir !== commonDir;
	const done: string[] = [];

	const name = sessionName(dir);
	if (name !== (await env.ownSession()) && (await succeeds(env.tmux(['has-session', '-t', `=${name}`])))) {
		await env.tmux(['kill-session', '-t', `=${name}`]);
		done.push(`closed tmux session ${name}`);
	}

	if (isWorktree) {
		const repo = dirname(commonDir);
		await git(['worktree', 'remove', dir], repo);
		done.push(`removed worktree ${shortDir(dir)}`);
		await git(['branch', '-D', branch], repo);
	} else {
		const base = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, '');
		await git(['checkout', base]);
		await git(['pull', '--ff-only']).catch(() => {});
		done.push(`switched ${shortDir(dir)} to ${base}`);
		await git(['branch', '-D', branch]);
	}
	done.push(`deleted branch ${branch}`);

	await env.removeFile(join(CLAUDE_STATE_DIR, stateFileName(dir)));
	return done;
}
