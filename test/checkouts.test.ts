import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {scanCheckouts} from '../src/checkouts.js';

function repo(root: string, name: string, branch: string, origin: string) {
	const dir = join(root, name);
	mkdirSync(dir);
	execFileSync('git', ['init', '-q', '-b', branch], {cwd: dir});
	execFileSync('git', ['remote', 'add', 'origin', origin], {cwd: dir});
	return dir;
}

test('scans git checkouts under the root, skipping plain folders', async () => {
	const root = mkdtempSync(join(tmpdir(), 'ghpr-projects-'));
	const ssh = repo(root, 'b-ssh', 'feat/x', 'git@github.com:Acme/App.git');
	const https = repo(root, 'a-https', 'main', 'https://github.com/acme/other.git');
	mkdirSync(join(root, 'notes'));
	repo(root, 'no-github', 'main', 'https://gitlab.com/acme/app.git');

	assert.deepEqual(await scanCheckouts(root), [
		{owner: 'acme', name: 'other', branch: 'main', dir: https},
		{owner: 'Acme', name: 'App', branch: 'feat/x', dir: ssh},
	]);
});

test('returns nothing for a missing root', async () => {
	assert.deepEqual(await scanCheckouts('/nonexistent/ghpr'), []);
});
