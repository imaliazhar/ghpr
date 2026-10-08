import {QueryClient, type Query, type QueryKey} from '@tanstack/query-core';
import type {Checkout} from './checkouts.js';
import {isBranchOf, type Branch} from './git.js';
import type {GitHub, PR} from './github.js';
import {nextFetches, targetKey, type Target} from './refresh.js';

export type PrSnapshot = {
	/** Your open PRs in search order, as far as their details are known. */
	mine: PR[];
	/** The current branch's PR, null when there is none, or undefined while that isn't known yet. */
	current: PR | null | undefined;
	/** Null until the local checkouts have been scanned once. */
	checkouts: Checkout[] | null;
	/** Checkouts on a branch with no open PR. */
	leftover: Checkout[];
	/** The merged PR, or null for none, of each leftover checkout looked up so far, by directory. */
	merged: Map<string, PR | null>;
	/** When each PR was last fetched, by url. */
	fetchedAt: Map<string, number>;
	/** When your PR search last ran. */
	listedAt: number | null;
	/** True once your PR search has run since start. */
	fresh: boolean;
	loading: boolean;
	/** The latest error of anything whose last fetch failed. */
	error: string | null;
};

export type PrSync = {
	getSnapshot(): PrSnapshot;
	subscribe(listener: () => void): () => void;
	/** What the user is looking at, which decides what is fetched first and most often. */
	setFocus(view: {focus: string[]; visible: string[]}): void;
	/** Fetches `url` now, even if a fetch of it is already running, and resolves to it as it is on GitHub. */
	refetch(url: string): Promise<PR>;
	/** Changes a PR locally without changing when it was fetched. */
	patch(url: string, change: (pr: PR) => PR): void;
	/** Makes everything due for fetching. */
	reload(): void;
	/** Scans the local checkouts again now. */
	rescan(): void;
	/** Writes the cache now instead of shortly after the latest fetch. */
	flush(): void;
	stop(): void;
};

export type CacheFile = {load(): unknown; save(value: unknown): void};

type Saved = {version: number; entries: {key: QueryKey; data: unknown; at: number}[]};

const CACHE_VERSION = 6;
const SAVE_DELAY = 1000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const branchId = (b: Branch) => `${b.owner}/${b.name}@${b.branch}`;
const checkoutId = (c: Checkout) => `${c.dir}@${c.branch}`;

/**
 * Keeps your PRs, the current branch's PR, the local checkouts and the merged PRs of leftover checkouts,
 * starting from the cache file and fetching what `nextFetches` says, in that order, as it becomes due.
 * Each result is in the snapshot as soon as it arrives, and the cache file is written shortly after.
 */
export function createPrSync(deps: {github: GitHub; scan: () => Promise<Checkout[]>; branch: Promise<Branch | null>; cache: CacheFile}): PrSync {
	const {github} = deps;
	const client = new QueryClient();
	const queries = client.getQueryCache();
	const startedAt = Date.now();
	const listeners = new Set<() => void>();
	const inFlight = new Map<string, Promise<unknown>>();
	let branch: Branch | null | undefined;
	let view = {focus: [] as string[], visible: [] as string[]};
	let refreshedAt = 0;
	let snapshot: PrSnapshot | null = null;
	let wakeTimer: ReturnType<typeof setTimeout> | undefined;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	const saved = deps.cache.load() as Saved | null;
	if (saved?.version === CACHE_VERSION) for (const {key, data, at} of saved.entries) client.setQueryData(key, data, {updatedAt: at});

	const dataOf = <T>(key: QueryKey) => client.getQueryData<T>(key);
	const prOf = (url: string) => dataOf<PR>(['pr', url]);
	const branchKey = (): QueryKey => ['branch', branch ? branchId(branch) : ''];
	const searchUrls = () => dataOf<string[]>(['search']) ?? [];
	const checkouts = () => dataOf<Checkout[]>(['checkouts']) ?? null;
	const currentUrl = () => (branch ? (dataOf<string | null>(branchKey()) ?? null) : null);

	function leftover(): Checkout[] {
		const open = [...searchUrls(), currentUrl()].flatMap(url => (url && prOf(url)) || []);
		return (checkouts() ?? []).filter(c => !open.some(pr => isBranchOf(pr, c)));
	}

	const mergedUrl = (c: Checkout) => dataOf<string | null>(['merged', checkoutId(c)]);

	function currentPr(): PR | null | undefined {
		if (branch !== undefined && !branch) return null;
		const state = branch && client.getQueryState<string | null>(branchKey());
		if (!state || state.data === undefined) return undefined;
		if (state.data === null) return state.dataUpdatedAt >= startedAt ? null : undefined;
		return prOf(state.data);
	}

	function build(): PrSnapshot {
		const searched = client.getQueryState<string[]>(['search']);
		const merged = new Map<string, PR | null>();
		for (const c of leftover()) {
			const url = mergedUrl(c);
			if (url === null) merged.set(c.dir, null);
			else if (url && prOf(url)) merged.set(c.dir, prOf(url)!);
		}
		const prQueries = queries.findAll({queryKey: ['pr']}).filter(q => q.state.data !== undefined);
		const failed = queries.getAll().filter(q => q.state.status === 'error' && q.state.fetchStatus === 'idle');
		const latestError = failed.sort((a, b) => b.state.errorUpdatedAt - a.state.errorUpdatedAt)[0];
		return {
			mine: searchUrls().flatMap(url => prOf(url) ?? []),
			current: currentPr(),
			checkouts: checkouts(),
			leftover: leftover(),
			merged,
			fetchedAt: new Map(prQueries.map(q => [q.queryKey[1] as string, q.state.dataUpdatedAt])),
			listedAt: searched?.dataUpdatedAt || null,
			fresh: (searched?.dataUpdatedAt ?? 0) >= startedAt,
			loading: inFlight.size > 0,
			error: latestError ? errorText(latestError.state.error) : null,
		};
	}

	function changed() {
		snapshot = null;
		listeners.forEach(listener => listener());
	}

	/** The `targetKey` a query is fetched for, or null when nothing fetches it any more. */
	function targetOf(key: QueryKey): string | null {
		const [kind, id] = key as [string, string?];
		if (kind === 'pr') return `pr:${id}`;
		if (kind === 'merged') return `merged:${id}`;
		if (kind === 'branch') return branch === undefined || (branch && id === branchId(branch)) ? 'branch' : null;
		return kind;
	}

	function queryOf(target: Target): {key: QueryKey; fn: () => Promise<unknown>} {
		switch (target.kind) {
			case 'search':
				return {key: ['search'], fn: () => github.searchMine()};
			case 'branch':
				return {key: branchKey(), fn: () => github.branchPr(branch!)};
			case 'checkouts':
				return {key: ['checkouts'], fn: () => deps.scan()};
			case 'pr':
				return {key: ['pr', target.url], fn: () => github.pr(target.url)};
			case 'merged': {
				const checkout = checkouts()?.find(c => checkoutId(c) === target.checkout);
				return {key: ['merged', target.checkout], fn: async () => (checkout ? github.mergedPr(checkout) : null)};
			}
		}
	}

	function start(target: Target, force = false): Promise<unknown> {
		const {key, fn} = queryOf(target);
		const options = client.defaultQueryOptions({queryKey: key, queryFn: fn, retry: false});
		const promise = queries.build(client, options).fetch(options, {cancelRefetch: force});
		const id = targetKey(target);
		inFlight.set(id, promise);
		promise
			.catch(() => {})
			.finally(() => {
				if (inFlight.get(id) === promise) inFlight.delete(id);
				scheduleSave();
				pump();
				changed();
			});
		return promise;
	}

	function pump() {
		if (stopped) return;
		const now = Date.now();
		const tried = new Map<string, number>();
		for (const q of queries.getAll()) {
			const id = targetOf(q.queryKey);
			const at = Math.max(q.state.dataUpdatedAt, q.state.errorUpdatedAt);
			if (id && at) tried.set(id, at);
		}
		const current = currentUrl();
		const left = leftover();
		const {targets, wakeAt} = nextFetches({
			now,
			refreshedAt,
			branch: !!branch,
			focus: current ? [...view.focus, current] : view.focus,
			visible: view.visible,
			listed: searchUrls(),
			leftover: left.map(checkoutId),
			merged: left.flatMap(c => mergedUrl(c) ?? []),
			lastTried: key => tried.get(key),
			fetching: new Set(inFlight.keys()),
		});
		targets.forEach(target => start(target));
		clearTimeout(wakeTimer);
		wakeTimer = wakeAt === null ? undefined : setTimeout(pump, wakeAt - now);
		if (targets.length) changed();
	}

	/** The queries anything still refers to, by `targetKey`. */
	function referenced(): Set<string> {
		const left = leftover();
		const urls = [...searchUrls(), currentUrl(), ...left.map(mergedUrl)].filter((url): url is string => !!url);
		return new Set(['search', 'branch', 'checkouts', ...urls.map(url => `pr:${url}`), ...left.map(c => `merged:${checkoutId(c)}`)]);
	}

	function save() {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		const keep = referenced();
		const entries: Saved['entries'] = [];
		for (const q of queries.getAll() as Query[]) {
			const id = targetOf(q.queryKey);
			if (!id || !keep.has(id)) {
				if (!inFlight.has(id ?? '')) queries.remove(q);
			} else if (q.state.data !== undefined) entries.push({key: q.queryKey, data: q.state.data, at: q.state.dataUpdatedAt});
		}
		deps.cache.save({version: CACHE_VERSION, entries} satisfies Saved);
	}

	function scheduleSave() {
		if (!stopped && !saveTimer) saveTimer = setTimeout(save, SAVE_DELAY);
	}

	deps.branch
		.catch(() => null)
		.then(b => {
			branch = b;
			changed();
			pump();
		});
	pump();

	return {
		getSnapshot: () => (snapshot ??= build()),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setFocus(next) {
			if (JSON.stringify(next) === JSON.stringify(view)) return;
			view = next;
			pump();
		},
		refetch: url => start({kind: 'pr', url}, true) as Promise<PR>,
		patch(url, change) {
			const state = client.getQueryState<PR>(['pr', url]);
			if (!state?.data) return;
			client.setQueryData(['pr', url], change(state.data), {updatedAt: state.dataUpdatedAt});
			changed();
		},
		reload() {
			refreshedAt = Date.now();
			pump();
		},
		rescan() {
			start({kind: 'checkouts'}, true);
			changed();
		},
		flush: save,
		stop() {
			stopped = true;
			clearTimeout(wakeTimer);
			clearTimeout(saveTimer);
		},
	};
}
