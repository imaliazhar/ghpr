import type {Checkout} from './checkouts.js';
import type {ClaudeState} from './claudeState.js';
import {isBranchOf} from './git.js';
import type {PR} from './github.js';
import type {PrSnapshot} from './prSync.js';

export type WorkspaceInput = Pick<PrSnapshot, 'mine' | 'current' | 'fresh' | 'checkouts' | 'leftover' | 'merged'> & {
	claudeStates: Map<string, ClaudeState>;
};

export type Workspace = {
	/** Your open PRs, then the merged PRs whose checkouts are still around. */
	listed: PR[];
	/** True when `listed` is complete: your PRs are fresh, checkouts are scanned and every leftover one is looked up. */
	settled: boolean;
	/** A listed PR, or the current branch's. */
	find: (url: string) => PR | undefined;
	checkoutOf: Map<string, Checkout>;
	claudeOf: Map<string, ClaudeState>;
};

/** What ghpr shows, from GitHub's PRs, the local checkouts and their claude sessions. */
export function workspace({mine, current, fresh, checkouts, leftover, merged, claudeStates}: WorkspaceInput): Workspace {
	const mergedPrs: PR[] = [];
	for (const c of leftover) {
		const pr = merged.get(c.dir);
		if (pr && !mine.some(p => p.url === pr.url) && !mergedPrs.some(p => p.url === pr.url)) mergedPrs.push(pr);
	}
	const listed = [...mine, ...mergedPrs];

	const all = current && !listed.some(p => p.url === current.url) ? [...listed, current] : listed;
	const checkoutOf = new Map(
		all.flatMap(pr => {
			const checkout = checkouts?.find(c => isBranchOf(pr, c));
			return checkout ? [[pr.url, checkout] as const] : [];
		}),
	);
	const claudeOf = new Map([...checkoutOf].flatMap(([url, c]) => (claudeStates.has(c.dir) ? [[url, claudeStates.get(c.dir)!] as const] : [])));

	return {
		listed,
		settled: fresh && checkouts !== null && leftover.every(c => merged.has(c.dir)),
		find: url => all.find(p => p.url === url),
		checkoutOf,
		claudeOf,
	};
}

/**
 * Where the app should start: the current branch's PR (and its repo tab, if that repo has PRs listed),
 * `null` for the list when there is no such PR, or `undefined` while that isn't known yet.
 */
export function startView({mine, current}: Pick<PrSnapshot, 'mine' | 'current'>): {url: string; tab: string | undefined} | null | undefined {
	if (!current) return current;
	return {url: current.url, tab: mine.some(p => p.repo === current.repo) ? current.repo : undefined};
}
