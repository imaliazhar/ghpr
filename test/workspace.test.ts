import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import type {Checkout} from '../src/checkouts.js';
import {startView, workspace, type WorkspaceInput} from '../src/workspace.js';
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
	leftover: [],
	merged: new Map(),
	claudeStates: new Map(),
	...overrides,
});

describe('workspace', () => {
	const open = pr({headRef: 'feat/open'});
	const merged = pr({headRef: 'feat/done', merged: true});
	const done = at('/p/done', 'feat/done');
	const main = at('/p/main', 'main');
	const checkouts = [at('/p/open', 'feat/open'), done, main];

	test('lists the merged PRs of leftover checkouts after open ones, once each', () => {
		const lookups = new Map([['/p/done', merged], ['/p/main', null], ['/p/again', merged]]);
		const ws = workspace(input({mine: [open], checkouts, leftover: [done, main, at('/p/again', 'feat/done')], merged: lookups}));
		assert.deepEqual(ws.listed, [open, merged]);
		assert.deepEqual(workspace(input({mine: [open], checkouts, leftover: [main], merged: lookups})).listed, [open]);
	});

	test('is settled once your PRs are fresh, checkouts are scanned and every leftover is looked up', () => {
		const settled = (overrides: Partial<WorkspaceInput>) => workspace(input({mine: [open], checkouts, leftover: [done, main], ...overrides})).settled;
		assert.equal(settled({merged: new Map([['/p/done', merged]])}), false);
		assert.equal(settled({merged: new Map([['/p/done', merged], ['/p/main', null]])}), true);
		assert.equal(settled({merged: new Map([['/p/done', merged], ['/p/main', null]]), fresh: false}), false);
		assert.equal(settled({checkouts: null, leftover: []}), false);
		assert.equal(settled({leftover: []}), true, 'nothing to look up');
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

describe('startView', () => {
	test("waits while the current branch's PR isn't known, and stays on the list when there is none", () => {
		assert.equal(startView({mine: [], current: undefined}), undefined);
		assert.equal(startView({mine: [], current: null}), null);
	});

	test("opens the branch PR and its repo tab when that repo has PRs listed", () => {
		const mine = pr({repo: 'acme/app'});
		const teammates = pr({repo: 'acme/other'});
		assert.deepEqual(startView({mine: [mine], current: mine}), {url: mine.url, tab: 'acme/app'});
		assert.deepEqual(startView({mine: [mine], current: teammates}), {url: teammates.url, tab: undefined});
	});
});
