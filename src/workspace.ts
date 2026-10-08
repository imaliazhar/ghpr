import type {Checkout} from './checkouts.js';
import type {ClaudeState} from './claudeState.js';
import {isBranchOf} from './git.js';
import type {PR} from './github.js';

/** Merged PRs found for the leftover checkouts that `key` names. */
export type MergedLookup = {key: string; prs: PR[]};

export type WorkspaceInput = {
	mine: PR[];
	current: PR | null;
	/** True once `mine` and `current` come from GitHub rather than the cache. */
	fresh: boolean;
	/** Null while the local checkouts are being scanned. */
	checkouts: Checkout[] | null;
	/** The latest merged PR lookup, which may be for an earlier set of leftover checkouts. */
	merged: MergedLookup | null;
	claudeStates: Map<string, ClaudeState>;
};

export type Workspace = {
	/** Your open PRs, then the merged PRs whose checkouts are still around. */
	listed: PR[];
	/** Checkouts on a branch with no open PR, to look up merged PRs for. Empty until `fresh`. */
	leftover: Checkout[];
	/** Identifies `leftover`, so a merged lookup can be matched to the checkouts it was for. */
	leftoverKey: string;
	/** True when `listed` is complete: data is fresh, checkouts are scanned and merged PRs are looked up. */
	settled: boolean;
	/** A listed PR, or the current branch's. */
	find: (url: string) => PR | undefined;
	checkoutOf: Map<string, Checkout>;
	claudeOf: Map<string, ClaudeState>;
};

/** What ghpr shows, from GitHub's PRs, the local checkouts and their claude sessions. */
export function workspace({mine, current, fresh, checkouts, merged, claudeStates}: WorkspaceInput): Workspace {
	const open = current ? [...mine, current] : mine;
	const leftover = fresh && checkouts ? checkouts.filter(c => !open.some(pr => isBranchOf(pr, c))) : [];
	const leftoverKey = leftover.map(c => `${c.dir}@${c.branch}`).join('\n');
	const mergedPrs = (merged?.prs ?? []).filter(m => !mine.some(p => p.url === m.url) && leftover.some(c => isBranchOf(m, c)));
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
		leftover,
		leftoverKey,
		settled: fresh && checkouts !== null && (!leftover.length || merged?.key === leftoverKey),
		find: url => all.find(p => p.url === url),
		checkoutOf,
		claudeOf,
	};
}
