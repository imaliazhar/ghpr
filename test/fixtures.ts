import type {PR} from '../src/github.js';
import {listView} from '../src/listModel.js';

let next = 1;

export function pr(overrides: Partial<PR> = {}): PR {
	const number = next++;
	return {
		repo: 'acme/app',
		number,
		title: `PR ${number}`,
		url: `https://github.com/acme/app/pull/${number}`,
		headRef: `branch-${number}`,
		reviewDecision: 'REVIEW_REQUIRED',
		labels: [],
		requiredChecks: [],
		optionalCheckCount: 0,
		pendingOptionalCount: 0,
		reviews: [],
		waitingOn: [],
		bot: null,
		queue: null,
		queueDenied: null,
		merged: false,
		headSha: 'abc123',
		...overrides,
	};
}

export const ready = (overrides: Partial<PR> = {}) => pr({reviewDecision: 'APPROVED', ...overrides});
export const failing = (overrides: Partial<PR> = {}) =>
	pr({requiredChecks: [{name: 'build', state: 'failing', url: null}], ...overrides});

/** A list of `prs` in one status group (a header, then the PRs), with the cursor on `cursor`. */
export const viewOf = (prs: PR[], cursor: string | null = null) =>
	listView(prs, {tab: null, archived: new Set(), showArchived: false}, cursor);
