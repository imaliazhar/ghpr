import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {FOCUS_INTERVAL, LIST_INTERVAL, MERGED_LOOKUP_INTERVAL, nextFetches, targetKey, type RefreshInput, type Target} from '../src/refresh.js';

const NOW = 1_000_000;

/** Everything already fetched just now, unless `tried` says otherwise. */
const input = (overrides: Partial<RefreshInput> & {tried?: Record<string, number | undefined>} = {}): RefreshInput => {
	const {tried = {}, ...rest} = overrides;
	return {
		now: NOW,
		refreshedAt: 0,
		branch: true,
		focus: [],
		visible: [],
		listed: [],
		leftover: [],
		merged: [],
		lastTried: key => (key in tried ? tried[key] : NOW),
		fetching: new Set(),
		...rest,
	};
};

const keys = (targets: Target[]) => targets.map(targetKey);

describe('nextFetches', () => {
	test('fetches the focused PRs, your PR search, the branch lookup and the checkout scan first', () => {
		const {targets} = nextFetches(
			input({focus: ['a'], visible: ['b'], tried: {'pr:a': undefined, 'pr:b': undefined, search: undefined, branch: undefined, checkouts: undefined}}),
		);
		assert.deepEqual(keys(targets), ['pr:a', 'search', 'branch', 'checkouts']);
	});

	test('skips the branch lookup when there is no current branch', () => {
		assert.deepEqual(keys(nextFetches(input({branch: false, tried: {branch: undefined}})).targets), []);
	});

	test('fetches the active tab, then the other PRs, then merged lookups, each once the tiers above are done', () => {
		const never = {'pr:b': undefined, 'pr:c': undefined, 'merged:/p@x': undefined, 'pr:m': undefined};
		const base = {focus: ['a'], visible: ['a', 'b'], listed: ['a', 'b', 'c'], leftover: ['/p@x'], merged: ['m']};
		assert.deepEqual(keys(nextFetches(input({...base, tried: never})).targets), ['pr:b']);
		assert.deepEqual(keys(nextFetches(input({...base, tried: {...never, 'pr:b': NOW}})).targets), ['pr:c']);
		assert.deepEqual(keys(nextFetches(input({...base, tried: {'merged:/p@x': undefined, 'pr:m': undefined}})).targets), ['merged:/p@x', 'pr:m']);
	});

	test('waits for a tier being fetched before starting a lower one', () => {
		const {targets} = nextFetches(input({visible: ['b'], listed: ['c'], tried: {'pr:b': undefined, 'pr:c': undefined}, fetching: new Set(['pr:b'])}));
		assert.deepEqual(targets, []);
	});

	test('fetches a newly focused PR while a lower tier is being fetched', () => {
		const {targets} = nextFetches(input({focus: ['a'], listed: ['c'], tried: {'pr:a': NOW - FOCUS_INTERVAL}, fetching: new Set(['pr:c'])}));
		assert.deepEqual(keys(targets), ['pr:a']);
	});

	test('refreshes focused PRs every 20s and the rest every 3 minutes', () => {
		const at = (now: number) => keys(nextFetches(input({now, focus: ['a'], listed: ['b']})).targets);
		assert.deepEqual(at(NOW + FOCUS_INTERVAL - 1), []);
		assert.deepEqual(at(NOW + FOCUS_INTERVAL), ['pr:a']);
		assert.deepEqual(at(NOW + LIST_INTERVAL), ['pr:a', 'search', 'branch', 'checkouts']);
		const later = nextFetches(input({now: NOW + LIST_INTERVAL, listed: ['b']}));
		assert.deepEqual(keys(later.targets), ['search', 'branch', 'checkouts'], 'other PRs wait for the first tier');
	});

	test('looks up merged PRs every 10 minutes and fetches the merged PRs found once', () => {
		const at = (now: number) => keys(nextFetches(input({now, leftover: ['/p@x'], merged: ['m'], tried: {search: now, branch: now, checkouts: now}})).targets);
		assert.deepEqual(at(NOW + MERGED_LOOKUP_INTERVAL - 1), []);
		assert.deepEqual(at(NOW + MERGED_LOOKUP_INTERVAL), ['merged:/p@x']);
		assert.deepEqual(at(NOW + 100 * MERGED_LOOKUP_INTERVAL), ['merged:/p@x']);
	});

	test('makes everything due again after a manual refresh', () => {
		const {targets} = nextFetches(input({refreshedAt: NOW + 1, now: NOW + 1, focus: ['a'], listed: ['b']}));
		assert.deepEqual(keys(targets), ['pr:a', 'search', 'branch', 'checkouts']);
	});

	test('lists a PR once, in its most urgent tier', () => {
		const {targets} = nextFetches(input({focus: ['a'], visible: ['a'], listed: ['a'], tried: {'pr:a': undefined}}));
		assert.deepEqual(keys(targets), ['pr:a']);
	});

	test('wakes when the next thing becomes due', () => {
		assert.equal(nextFetches(input({focus: ['a']})).wakeAt, NOW + FOCUS_INTERVAL);
		assert.equal(nextFetches(input()).wakeAt, NOW + LIST_INTERVAL);
		assert.equal(nextFetches(input({now: NOW + LIST_INTERVAL, branch: false, tried: {search: NOW + LIST_INTERVAL, checkouts: NOW + LIST_INTERVAL}, merged: ['m']})).wakeAt, NOW + 2 * LIST_INTERVAL);
	});
});
