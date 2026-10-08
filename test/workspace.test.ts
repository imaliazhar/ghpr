import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import type {Checkout} from '../src/checkouts.js';
import {workspace, type WorkspaceInput} from '../src/workspace.js';
import {pr} from './fixtures.js';

const at = (dir: string, branch: string, repo = 'acme/app'): Checkout => {
	const [owner, name] = repo.split('/');
	return {owner, name, branch, dir};
};

const input = (overrides: Partial<WorkspaceInput> = {}): WorkspaceInput => ({
	mine: [],
	current: null,
	fresh: true,
	checkouts: [],
	merged: null,
	claudeStates: new Map(),
	...overrides,
});

describe('workspace', () => {
	const open = pr({headRef: 'feat/open'});
	const merged = pr({headRef: 'feat/done', merged: true});
	const checkouts = [at('/p/open', 'feat/open'), at('/p/done', 'feat/done'), at('/p/main', 'main')];

	test('checkouts with no open PR are leftovers, once data is fresh and checkouts are scanned', () => {
		assert.deepEqual(workspace(input({mine: [open], checkouts})).leftover.map(c => c.dir), ['/p/done', '/p/main']);
		assert.deepEqual(workspace(input({mine: [open], checkouts, fresh: false})).leftover, []);
		assert.deepEqual(workspace(input({mine: [open], checkouts: null})).leftover, []);
	});

	test('lists merged PRs after open ones, only while their checkout is still a leftover', () => {
		const lookup = {key: 'old', prs: [merged, open]};
		assert.deepEqual(workspace(input({mine: [open], checkouts, merged: lookup})).listed, [open, merged]);
		const cleanedUp = checkouts.filter(c => c.dir !== '/p/done');
		assert.deepEqual(workspace(input({mine: [open], checkouts: cleanedUp, merged: lookup})).listed, [open]);
	});

	test('is settled once the merged lookup matches the current leftovers', () => {
		const ws = workspace(input({mine: [open], checkouts}));
		assert.equal(ws.settled, false);
		assert.equal(workspace(input({mine: [open], checkouts, merged: {key: 'stale', prs: []}})).settled, false);
		assert.equal(workspace(input({mine: [open], checkouts, merged: {key: ws.leftoverKey, prs: []}})).settled, true);
		assert.equal(workspace(input({mine: [open], checkouts: [at('/p/open', 'feat/open')]})).settled, true, 'nothing to look up');
		assert.equal(workspace(input({mine: [open], checkouts: null})).settled, false);
	});

	test('maps PRs, including the current one, to the first checkout on their branch and its claude session', () => {
		const current = pr({repo: 'acme/web', headRef: 'fix'});
		const fork = pr({headRef: 'feat/y'});
		const ws = workspace(
			input({
				mine: [open, fork],
				current,
				checkouts: [at('/p/one', 'feat/open', 'Acme/App'), at('/p/two', 'feat/open'), at('/p/fork', 'feat/y', 'acme/fork'), at('/p/web', 'fix', 'acme/web')],
				claudeStates: new Map([['/p/web', 'working']]),
			}),
		);
		assert.equal(ws.checkoutOf.get(open.url)?.dir, '/p/one');
		assert.equal(ws.checkoutOf.has(fork.url), false);
		assert.deepEqual([...ws.claudeOf], [[current.url, 'working']]);
		assert.equal(ws.find(current.url), current);
		assert.deepEqual(ws.listed, [open, fork]);
	});
});
