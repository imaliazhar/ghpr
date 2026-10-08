import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {cleanUpWorkspace, UncommittedChangesError, type CleanupEnv} from '../src/cleanup.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();

/** An origin with a merged branch `feature`, and a clone of it checked out on `main`. */
function repos() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'ghpr-cleanup-')));
	const origin = join(root, 'origin');
	execFileSync('git', ['init', '-q', '-b', 'main', origin]);
	git(origin, 'commit', '-q', '--allow-empty', '-m', 'base');
	git(origin, 'checkout', '-q', '-b', 'feature');
	git(origin, 'commit', '-q', '--allow-empty', '-m', 'feature work');
	const headSha = git(origin, 'rev-parse', 'HEAD');
	git(origin, 'checkout', '-q', 'main');
	const clone = join(root, 'app');
	execFileSync('git', ['clone', '-q', origin, clone]);
	return {root, clone, headSha};
}

/** A tmux with the given sessions that records what it's asked to do. */
function fakeEnv(sessions: string[], ownSession: string | null = null) {
	const calls: string[] = [];
	const forgotten: string[] = [];
	const env: CleanupEnv = {
		git: async (cwd, args) => git(cwd, ...args),
		tmux: async args => {
			calls.push(args.join(' '));
			if (args[0] === 'has-session' && !sessions.includes(args[2].slice(1))) throw new Error('no session');
			return '';
		},
		ownSession: async () => ownSession,
		forgetClaudeState: async dir => void forgotten.push(dir),
	};
	return {env, calls, forgotten};
}

const checkoutOf = (dir: string) => ({owner: 'acme', name: 'app', branch: 'feature', dir});

test('removes a worktree and its branch, and closes its tmux session', async () => {
	const {root, clone, headSha} = repos();
	const dir = join(root, 'feature-tree');
	git(clone, 'worktree', 'add', '-q', dir, 'feature');
	const {env, calls, forgotten} = fakeEnv(['feature-tree']);

	const done = await cleanUpWorkspace(checkoutOf(dir), headSha, {}, env);

	assert.deepEqual(done.slice(1), ['deleted branch feature', 'closed tmux session feature-tree']);
	assert.ok(calls.includes('kill-session -t =feature-tree'));
	assert.ok(!existsSync(dir));
	assert.equal(git(clone, 'branch', '--list', 'feature'), '');
	assert.deepEqual(forgotten, [dir]);
});

test('switches a clone back to its default branch instead of removing it', async () => {
	const {clone, headSha} = repos();
	git(clone, 'checkout', '-q', 'feature');
	const {env, calls} = fakeEnv([]);

	const done = await cleanUpWorkspace(checkoutOf(clone), headSha, {}, env);

	assert.equal(git(clone, 'branch', '--show-current'), 'main');
	assert.equal(git(clone, 'branch', '--list', 'feature'), '');
	assert.ok(!calls.some(c => c.startsWith('kill-session')));
	assert.deepEqual(done.slice(1), ['deleted branch feature']);
});

test('leaves the tmux session ghpr runs in open', async () => {
	const {clone, headSha} = repos();
	git(clone, 'checkout', '-q', 'feature');
	const {env, calls} = fakeEnv(['app'], 'app');
	await cleanUpWorkspace(checkoutOf(clone), headSha, {}, env);
	assert.ok(!calls.some(c => c.startsWith('kill-session')));
});

test('refuses without changing anything when there are uncommitted changes or unmerged commits', async () => {
	const {root, clone, headSha} = repos();
	const dir = join(root, 'feature-tree');
	git(clone, 'worktree', 'add', '-q', dir, 'feature');
	const {env, calls} = fakeEnv(['feature-tree']);

	writeFileSync(join(dir, 'notes.txt'), 'wip');
	await assert.rejects(cleanUpWorkspace(checkoutOf(dir), headSha, {}, env), UncommittedChangesError);

	git(dir, 'add', 'notes.txt');
	git(dir, 'commit', '-q', '-m', 'after merge');
	writeFileSync(join(dir, 'more.txt'), 'wip');
	await assert.rejects(cleanUpWorkspace(checkoutOf(dir), headSha, {discard: true}, env), /commits that aren't in the merged PR/);

	assert.ok(existsSync(dir));
	assert.ok(!calls.some(c => c.startsWith('kill-session')));
});

test('discards uncommitted changes when asked, in a worktree and in a clone', async () => {
	const {root, clone, headSha} = repos();
	const dir = join(root, 'feature-tree');
	git(clone, 'worktree', 'add', '-q', dir, 'feature');
	writeFileSync(join(dir, 'notes.txt'), 'wip');
	const done = await cleanUpWorkspace(checkoutOf(dir), headSha, {discard: true}, fakeEnv([]).env);
	assert.match(done[0], /discarded uncommitted changes/);
	assert.ok(!existsSync(dir));

	git(clone, 'checkout', '-q', '-b', 'feature', 'origin/feature');
	writeFileSync(join(clone, 'notes.txt'), 'wip');
	await cleanUpWorkspace(checkoutOf(clone), headSha, {discard: true}, fakeEnv([]).env);
	assert.equal(git(clone, 'branch', '--show-current'), 'main');
	assert.equal(git(clone, 'status', '--porcelain'), '');
});

test('removes a worktree of a bare repo', async () => {
	const {root, headSha} = repos();
	const bare = join(root, 'app.git');
	execFileSync('git', ['clone', '-q', '--bare', join(root, 'origin'), bare]);
	const dir = join(root, 'feature-tree');
	git(bare, 'worktree', 'add', '-q', dir, 'feature');
	const {env} = fakeEnv([]);

	await cleanUpWorkspace(checkoutOf(dir), headSha, {}, env);

	assert.ok(!existsSync(dir));
	assert.equal(git(bare, 'branch', '--list', 'feature'), '');
});

test('keeps the tmux session when a git step fails', async () => {
	const {clone, headSha} = repos();
	git(clone, 'checkout', '-q', 'feature');
	git(clone, 'remote', 'set-head', 'origin', '--delete');
	const {env, calls} = fakeEnv(['app']);

	await assert.rejects(cleanUpWorkspace(checkoutOf(clone), headSha, {}, env), /default branch/);

	assert.equal(git(clone, 'branch', '--show-current'), 'feature');
	assert.ok(!calls.some(c => c.startsWith('kill-session')));
});
