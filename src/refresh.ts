/** Something ghpr fetches: your PR search, the current branch's PR lookup, the local checkouts, a PR, or a checkout's merged PR lookup. */
export type Target =
	| {kind: 'search'}
	| {kind: 'branch'}
	| {kind: 'checkouts'}
	| {kind: 'pr'; url: string}
	| {kind: 'merged'; checkout: string};

export const targetKey = (t: Target) => (t.kind === 'pr' ? `pr:${t.url}` : t.kind === 'merged' ? `merged:${t.checkout}` : t.kind);

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const FOCUS_INTERVAL = 20 * SECOND;
export const LIST_INTERVAL = 3 * MINUTE;
export const MERGED_LOOKUP_INTERVAL = 10 * MINUTE;

export type RefreshInput = {
	now: number;
	/** When the user last asked for everything to be refreshed. Anything last tried before it is due. */
	refreshedAt: number;
	/** Whether there is a current branch to look up the PR of. */
	branch: boolean;
	/** The PRs being looked at: the open or highlighted one and the current branch's. */
	focus: string[];
	/** The PRs in the active tab. */
	visible: string[];
	/** Every listed PR. */
	listed: string[];
	/** Checkouts (`dir@branch`) with no open PR, to look up a merged PR for. */
	leftover: string[];
	/** Merged PRs found for leftover checkouts. */
	merged: string[];
	/** When a target was last fetched or failed to, by `targetKey`. */
	lastTried: (key: string) => number | undefined;
	/** Targets being fetched, by `targetKey`. */
	fetching: ReadonlySet<string>;
};

type Item = {target: Target; key: string; interval: number};

const pr = (url: string, interval: number): Item => ({target: {kind: 'pr', url}, key: `pr:${url}`, interval});
const one = (kind: 'search' | 'branch' | 'checkouts', interval: number): Item => ({target: {kind}, key: kind, interval});

/**
 * What to fetch next and when to look again. Targets come in tiers, most urgent first:
 * 1. the focused PRs (every 20s), your PR search, the current branch lookup and the checkout scan (every 3 min);
 * 2. the active tab's PRs (every 3 min);
 * 3. the other listed PRs (every 3 min);
 * 4. merged PR lookups for leftover checkouts (every 10 min) and the merged PRs they find (once).
 *
 * Only the first tier with anything due or being fetched is fetched from, so a lower tier waits until every
 * tier above it is done. Something never tried is always due. `wakeAt` is the next time something becomes due,
 * or null when nothing will.
 */
export function nextFetches(input: RefreshInput): {targets: Target[]; wakeAt: number | null} {
	const tiers: Item[][] = [
		[
			...input.focus.map(url => pr(url, FOCUS_INTERVAL)),
			one('search', LIST_INTERVAL),
			...(input.branch ? [one('branch', LIST_INTERVAL)] : []),
			one('checkouts', LIST_INTERVAL),
		],
		input.visible.map(url => pr(url, LIST_INTERVAL)),
		input.listed.map(url => pr(url, LIST_INTERVAL)),
		[
			...input.leftover.map(checkout => ({target: {kind: 'merged', checkout} as Target, key: `merged:${checkout}`, interval: MERGED_LOOKUP_INTERVAL})),
			...input.merged.map(url => pr(url, Infinity)),
		],
	];

	const seen = new Set<string>();
	const unique = tiers.map(tier => tier.filter(item => !seen.has(item.key) && seen.add(item.key)));

	const dueAt = ({key, interval}: Item) => {
		const last = input.lastTried(key);
		return last === undefined || last < input.refreshedAt ? -Infinity : last + interval;
	};
	const isDue = (item: Item) => !input.fetching.has(item.key) && dueAt(item) <= input.now;

	const active = unique.find(tier => tier.some(item => input.fetching.has(item.key) || isDue(item))) ?? [];
	const later = unique
		.flat()
		.filter(item => !input.fetching.has(item.key))
		.map(dueAt)
		.filter(at => at > input.now && at < Infinity);

	return {targets: active.filter(isDue).map(item => item.target), wakeAt: later.length ? Math.min(...later) : null};
}
