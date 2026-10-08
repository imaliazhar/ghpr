import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {forgetClaudeState, readClaudeStates} from '../src/claudeState.js';

const record = (home: string, dir: string, state: string) =>
	execFileSync('bin/ghpr-claude-state', [state], {input: '{}', env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: dir}});

test('reads the states the hook script records, and forgets ended sessions', async () => {
	const home = mkdtempSync(join(tmpdir(), 'ghpr-'));
	const root = join(home, '.cache', 'ghpr', 'claude');
	record(home, '/p/my.app', 'working');
	record(home, '/p/web', 'permission');
	record(home, '/p/old', 'waiting');
	record(home, '/p/old', 'ended');
	assert.deepEqual(await readClaudeStates(root), new Map([['/p/my.app', 'working'], ['/p/web', 'permission']]));
});

test('ignores unknown states and a missing folder', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ghpr-'));
	writeFileSync(join(root, '%p%app'), 'sleeping\n');
	assert.deepEqual(await readClaudeStates(root), new Map());
	assert.deepEqual(await readClaudeStates(join(root, 'missing')), new Map());
});

test('forgets a session the hook script recorded', async () => {
	const home = mkdtempSync(join(tmpdir(), 'ghpr-'));
	const root = join(home, '.cache', 'ghpr', 'claude');
	record(home, '/p/app', 'waiting');
	record(home, '/p/web', 'working');
	await forgetClaudeState('/p/app', root);
	await forgetClaudeState('/p/never', root);
	assert.deepEqual(await readClaudeStates(root), new Map([['/p/web', 'working']]));
});
