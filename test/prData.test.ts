import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {initialPrData, prDataReducer, startView, type PrData, type PrEvent} from '../src/prData.js';
import {pr} from './fixtures.js';

const branchOf = (p: {repo: string; headRef: string}) => {
	const [owner, name] = p.repo.split('/');
	return {owner, name, branch: p.headRef};
};
const reduce = (state: PrData, ...events: PrEvent[]) => events.reduce(prDataReducer, state);

describe('prDataReducer', () => {
	test('starts from the cache, loading, with its timestamp', () => {
		const cached = [pr()];
		const state = initialPrData({savedAt: 123, mine: cached});
		assert.deepEqual(state, {mine: cached, current: null, fresh: false, loading: true, error: null, fetchedAt: 123});
		assert.deepEqual(initialPrData(null).mine, []);
	});

	test('finds the branch PR in cached data, but not once fresh data has arrived', () => {
		const a = pr();
		const cached = initialPrData({savedAt: 1, mine: [a]});
		assert.equal(reduce(cached, {type: 'branchKnown', branch: branchOf(a)}).current, a);
		assert.equal(reduce(cached, {type: 'branchKnown', branch: null}).current, null);
		const fresh = reduce(cached, {type: 'fetched', mine: [a], current: null, at: 2});
		assert.equal(reduce(fresh, {type: 'branchKnown', branch: branchOf(a)}).current, null);
	});

	test('a fetch replaces the data and clears an earlier error', () => {
		const a = pr();
		const failed = reduce(initialPrData(null), {type: 'fetchFailed', error: 'boom'});
		assert.deepEqual([failed.loading, failed.error], [false, 'boom']);
		const done = reduce(failed, {type: 'fetchStarted'}, {type: 'fetched', mine: [a], current: a, at: 9});
		assert.deepEqual(done, {mine: [a], current: a, fresh: true, loading: false, error: null, fetchedAt: 9});
	});

	test('a failed fetch keeps the data it had', () => {
		const a = pr();
		const state = reduce(initialPrData({savedAt: 1, mine: [a]}), {type: 'fetchFailed', error: 'x'});
		assert.deepEqual([state.mine, state.fetchedAt, state.fresh], [[a], 1, false]);
	});

	test('patches apply to the list and the current PR', () => {
		const a = pr();
		const b = pr();
		const state = reduce(initialPrData(null), {type: 'fetched', mine: [a, b], current: a, at: 1}, {type: 'patched', url: a.url, patch: p => ({...p, title: 'new'})});
		assert.deepEqual([state.mine[0].title, state.mine[1].title, state.current?.title], ['new', b.title, 'new']);
	});
});

describe('startView', () => {
	test('waits until the branch PR or fresh data is known', () => {
		assert.equal(startView(initialPrData(null)), undefined);
		assert.equal(startView(reduce(initialPrData(null), {type: 'fetched', mine: [], current: null, at: 1})), null);
	});

	test("opens the branch PR and its repo tab when that repo has PRs listed", () => {
		const mine = pr({repo: 'acme/app'});
		const teammates = pr({repo: 'acme/other'});
		const state = (current: typeof mine) => reduce(initialPrData(null), {type: 'fetched', mine: [mine], current, at: 1});
		assert.deepEqual(startView(state(mine)), {url: mine.url, tab: 'acme/app'});
		assert.deepEqual(startView(state(teammates)), {url: teammates.url, tab: undefined});
	});
});
