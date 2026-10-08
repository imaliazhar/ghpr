import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {promisify} from 'node:util';
import {forgetClaudeState} from './claudeState.js';
import type {Checkout} from './checkouts.js';
import {sessionName} from './tmux.js';

const exec = promisify(execFile);

/** What `cleanUpWorkspace` needs from git, tmux and claude. */
export type CleanupEnv = {
	git: (cwd: string, args: string[]) => Promise<string>;
	tmux: (args: string[]) => Promise<string>;
	/** The tmux session ghpr runs in, if any. */
	ownSession: () => Promise<string | null>;
	forgetClaudeState: (dir: string) => Promise<void>;
};

const defaultEnv: CleanupEnv = {
	git: async (cwd, args) => (await exec('git', args, {cwd})).stdout.trim(),
	tmux: async args => (await exec('tmux', args)).stdout.trim(),
	ownSession: async () =>
		process.env.TMUX ? (await exec('tmux', ['display-message', '-p', '#{session_name}']).catch(() => null))?.stdout.trim() ?? null : null,
	forgetClaudeState,
};

const succeeds = (promise: Promise<unknown>) => promise.then(() => true, () => false);
const shortDir = (dir: string) => dir.replace(homedir(), '~');

/** Thrown by `cleanUpWorkspace` when the workspace has uncommitted changes and `discard` isn't set. */
export class UncommittedChangesError extends Error {}

/**
 * Cleans up the local workspace of a merged PR: removes it when it's a worktree or switches it back to the
 * default branch when it's a clone, deletes the branch, closes its tmux session (unless ghpr runs in it),
 * and forgets its claude state. `headSha` is the merged PR's head commit.
 *
 * Refuses, before changing anything, when the branch has commits that aren't in the PR, a clone's default
 * branch isn't known, or the workspace has uncommitted changes, which `discard` throws away instead
 * (ignored files are kept in a clone). The tmux session is only closed once the git steps have
 * succeeded. Returns what it did, in order.
 */
export async function cleanUpWorkspace(
	checkout: Checkout,
	headSha: string,
	{discard = false} = {},
	env: CleanupEnv = defaultEnv,
): Promise<string[]> {
	const {dir, branch} = checkout;
	const git = (args: string[], cwd = dir) => env.git(cwd, args);

	const inPr = () => succeeds(git(['merge-base', '--is-ancestor', branch, headSha]));
	if (!(await inPr()) && !((await succeeds(git(['fetch', 'origin', headSha]))) && (await inPr()))) {
		throw new Error(`${branch} has commits that aren't in the merged PR`);
	}
	const [gitDir, commonDir] = (await git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])).split('\n');
	const isWorktree = gitDir !== commonDir;
	const base = isWorktree ? null : await defaultBranch(git, dir);
	const dirty = !!(await git(['status', '--porcelain']));
	if (dirty && !discard) throw new UncommittedChangesError(`${shortDir(dir)} has uncommitted changes`);
	const done: string[] = [];

	if (dirty && base) {
		await git(['reset', '--hard']);
		await git(['clean', '-fd']);
	}
	if (dirty) done.push(`discarded uncommitted changes in ${shortDir(dir)}`);
	if (base) {
		await git(['checkout', base]);
		await git(['pull', '--ff-only']).catch(() => {});
		done.push(`switched ${shortDir(dir)} to ${base}`);
		await git(['branch', '-D', branch]);
	} else {
		await git(['worktree', 'remove', ...(dirty ? ['--force'] : []), dir], commonDir);
		done.push(`removed worktree ${shortDir(dir)}`);
		await git(['branch', '-D', branch], commonDir);
	}
	done.push(`deleted branch ${branch}`);

	const name = sessionName(dir);
	if (name !== (await env.ownSession()) && (await succeeds(env.tmux(['has-session', '-t', `=${name}`])))) {
		await env.tmux(['kill-session', '-t', `=${name}`]);
		done.push(`closed tmux session ${name}`);
	}

	await env.forgetClaudeState(dir);
	return done;
}

async function defaultBranch(git: (args: string[]) => Promise<string>, dir: string) {
	const ref = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => {
		throw new Error(`Can't tell the default branch of ${shortDir(dir)}; run git remote set-head origin --auto`);
	});
	return ref.replace(/^origin\//, '');
}
