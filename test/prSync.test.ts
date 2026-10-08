import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, mock, test} from 'node:test';
import type {Checkout} from '../src/checkouts.js';
import type {Branch} from '../src/git.js';
import {createGitHub} from '../src/github.js';
import {createPrSync, type CacheFile, type PrSync} from '../src/prSync.js';
import {FOCUS_INTERVAL, LIST_INTERVAL} from '../src/refresh.js';
import {fakeGitHub, raw, type Repo} from './fakeGitHub.js';

const NOW = 1_000_000;
const url = (n: number) => `https://github.com/acme/app/pull/${n}`;
const numbersIn = (query: string) => [...query.matchAll(/pullRequest\(number: (\d+)\)/g)].map(m => Number(m[1]));

/** Lets every answered query and the work it triggers finish. */
const idle = async () => {
	for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
};

const memoryCache = (): CacheFile & {value: unknown} => ({
	value: null,
	load() {
		return this.value;
	},
	save(value) {
		this.value = structuredClone(value);
	},
});

/** A sync over a fake GitHub, which holds every query until it is released when `hold` is set. */
function setup(options: {mine?: number[]; repos?: Record<string, Repo>; branch?: Branch | null; checkouts?: Checkout[]; cache?: CacheFile; hold?: boolean} = {}) {
	const mine = options.mine ?? [1, 2, 3, 4, 5, 6];
	const repos = options.repos ?? {'acme/app': {prs: mine.map(n => raw('acme/app', n))}};
	const fake = fakeGitHub(repos, mine.map(n => ['acme/app', n]));
	const cache = options.cache ?? memoryCache();
	if (options.hold) fake.hold();
	const sync = createPrSync({
		github: createGitHub(fake.graphql),
		scan: async (...args: unknown[]) => {
			assert.deepEqual(args, [], 'scans its default folder');
			return options.checkouts ?? [];
		},
		branch: Promise.resolve(options.branch ?? null),
		cache,
	});
	syncs.push(sync);
	const detailQueries = () => fake.queries.filter(q => q.includes('pullRequest(number:')).map(numbersIn);
	return {...fake, repos, sync, cache, detailQueries};
}

let syncs: PrSync[] = [];

beforeEach(() => mock.timers.enable({apis: ['setTimeout', 'Date'], now: NOW}));
afterEach(() => {
	syncs.forEach(s => s.stop());
	syncs = [];
	mock.timers.reset();
});

describe('createPrSync', () => {
	test('fetches the focused PR on its own first, then the active tab, then the other PRs', async () => {
		const {sync, detailQueries} = setup();
		sync.setFocus({focus: [url(3)], visible: [1, 2, 3, 4].map(url)});
		await idle();
		assert.deepEqual(detailQueries(), [[3], [1, 2, 4], [5, 6]]);
		assert.deepEqual(sync.getSnapshot().mine.map(p => p.number), [1, 2, 3, 4, 5, 6]);
		assert.equal(sync.getSnapshot().loading, false);
	});

	test('shows each result as soon as it arrives', async () => {
		const {sync, release} = setup({hold: true});
		sync.setFocus({focus: [url(3)], visible: [1, 2, 3].map(url)});
		await idle();
		release();
		await idle();
		assert.deepEqual(sync.getSnapshot().mine, [], 'the search has arrived, but no PR details yet');
		assert.equal(sync.getSnapshot().fresh, true);
		release();
		await idle();
		assert.deepEqual(sync.getSnapshot().mine.map(p => p.number), [3]);
		assert.equal(sync.getSnapshot().fetchedAt.get(url(3)), NOW);
		assert.equal(sync.getSnapshot().loading, true, 'the active tab is being fetched');
	});

	test('starts the next run from the cache, with when each PR was fetched', async () => {
		const first = setup();
		await idle();
		first.sync.flush();

		mock.timers.tick(LIST_INTERVAL / 2);
		const next = setup({cache: first.cache, hold: true});
		const snapshot = next.sync.getSnapshot();
		assert.deepEqual(snapshot.mine.map(p => p.number), [1, 2, 3, 4, 5, 6]);
		assert.equal(snapshot.fetchedAt.get(url(1)), NOW);
		assert.equal(snapshot.listedAt, NOW);
		assert.equal(snapshot.fresh, false);
		await idle();
		assert.deepEqual(next.detailQueries(), [], 'nothing is due yet');
	});

	test('refreshes the focused PR every 20s and the others every 3 minutes', async () => {
		const {sync, queries, detailQueries} = setup();
		sync.setFocus({focus: [url(3)], visible: []});
		await idle();
		const before = queries.length;

		mock.timers.tick(FOCUS_INTERVAL);
		await idle();
		assert.deepEqual(detailQueries().slice(-1), [[3]]);
		assert.equal(queries.length, before + 1);

		mock.timers.tick(LIST_INTERVAL - FOCUS_INTERVAL);
		await idle();
		assert.deepEqual(detailQueries().slice(-3), [[3], [1, 2, 4, 5], [6]]);
		assert.equal(queries.some((q, i) => i > before && q.includes('search(')), true);
	});

	test('refetches just one PR after an action and resolves to it as it is on GitHub', async () => {
		const {sync, repos, queries} = setup();
		await idle();
		const before = queries.length;
		repos['acme/app'].prs[1].title = 'renamed';

		const fresh = await sync.refetch(url(2));

		assert.equal(fresh.title, 'renamed');
		assert.equal(sync.getSnapshot().mine[1].title, 'renamed');
		assert.deepEqual(queries.slice(before).map(numbersIn), [[2]]);
	});

	test('patches a PR without changing when it was fetched', async () => {
		const {sync} = setup();
		await idle();
		mock.timers.tick(1000);
		sync.patch(url(2), p => ({...p, title: 'patched'}));
		assert.equal(sync.getSnapshot().mine[1].title, 'patched');
		assert.equal(sync.getSnapshot().fetchedAt.get(url(2)), NOW);
	});

	test("finds the current branch's PR and the merged PRs of leftover checkouts", async () => {
		const repos = {
			'acme/app': {prs: [raw('acme/app', 1, {headRefName: 'mine'})], merged: [raw('acme/app', 9, {headRefName: 'done', merged: true})]},
			'acme/web': {prs: [raw('acme/web', 7, {headRefName: 'theirs'})]},
		};
		const checkout = (dir: string, branch: string, name = 'app'): Checkout => ({owner: 'acme', name, branch, dir});
		const {sync} = setup({
			mine: [1],
			repos,
			branch: {owner: 'acme', name: 'web', branch: 'theirs'},
			checkouts: [checkout('/p/mine', 'mine'), checkout('/p/done', 'done'), checkout('/p/web', 'theirs', 'web'), checkout('/p/wip', 'wip')],
		});
		assert.equal(sync.getSnapshot().current, undefined);
		await idle();

		const snapshot = sync.getSnapshot();
		assert.equal(snapshot.current?.url, 'https://github.com/acme/web/pull/7');
		assert.deepEqual(snapshot.leftover.map(c => c.dir), ['/p/done', '/p/wip']);
		assert.deepEqual([...snapshot.merged].map(([dir, pr]) => [dir, pr?.number ?? null]), [['/p/done', 9], ['/p/wip', null]]);
	});

	test('keeps the data it has when a fetch fails, and reports the error', async () => {
		const {sync, repos} = setup({mine: [1]});
		await idle();
		repos['acme/app'].prs = [];
		await sync.refetch(url(1)).catch(() => {});
		assert.equal(sync.getSnapshot().mine[0].number, 1);
		assert.match(sync.getSnapshot().error ?? '', /not found/);
	});
});
