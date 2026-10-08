import {findBranchPr, type Branch} from './git.js';
import type {PR} from './github.js';

export type PrData = {
	mine: PR[];
	/** The PR for the current branch, which may not be one of `mine`. */
	current: PR | null;
	/** True once this run has fetched from GitHub; until then `mine` comes from the cache. */
	fresh: boolean;
	loading: boolean;
	error: string | null;
	fetchedAt: number | null;
};

export type PrEvent =
	| {type: 'branchKnown'; branch: Branch | null}
	| {type: 'fetchStarted'}
	| {type: 'fetched'; mine: PR[]; current: PR | null; at: number}
	| {type: 'fetchFailed'; error: string}
	| {type: 'patched'; url: string; patch: (pr: PR) => PR};

export const initialPrData = (cache: {savedAt: number; mine: PR[]} | null): PrData => ({
	mine: cache?.mine ?? [],
	current: null,
	fresh: false,
	loading: true,
	error: null,
	fetchedAt: cache?.savedAt ?? null,
});

export function prDataReducer(state: PrData, event: PrEvent): PrData {
	switch (event.type) {
		case 'branchKnown':
			return state.fresh || !event.branch ? state : {...state, current: findBranchPr(state.mine, event.branch)};
		case 'fetchStarted':
			return {...state, loading: true};
		case 'fetched':
			return {mine: event.mine, current: event.current, fresh: true, loading: false, error: null, fetchedAt: event.at};
		case 'fetchFailed':
			return {...state, loading: false, error: event.error};
		case 'patched': {
			const apply = (pr: PR) => (pr.url === event.url ? event.patch(pr) : pr);
			return {...state, mine: state.mine.map(apply), current: state.current && apply(state.current)};
		}
	}
}

/**
 * Where the app should start: the current branch's PR (and its repo tab, if that repo has PRs listed),
 * `null` for the list once fresh data shows there is none, or `undefined` while that isn't known yet.
 */
export function startView({mine, current, fresh}: PrData): {url: string; tab: string | undefined} | null | undefined {
	if (current) return {url: current.url, tab: mine.some(p => p.repo === current.repo) ? current.repo : undefined};
	return fresh ? null : undefined;
}
