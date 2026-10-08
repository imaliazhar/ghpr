import type {PR} from '../src/github.js';

let next = 1;

export function pr(overrides: Partial<PR> = {}): PR {
	const number = next++;
	return {
		repo: 'acme/app',
		number,
		title: `PR ${number}`,
		url: `https://github.com/acme/app/pull/${number}`,
		headRef: `branch-${number}`,
		isDraft: false,
		hasConflicts: false,
		reviewDecision: 'REVIEW_REQUIRED',
		labels: [],
		requiredChecks: [],
		optionalCheckCount: 0,
		reviews: [],
		waitingOn: [],
		bot: null,
		...overrides,
	};
}

export const ready = (overrides: Partial<PR> = {}) => pr({reviewDecision: 'APPROVED', ...overrides});
export const failing = (overrides: Partial<PR> = {}) =>
	pr({requiredChecks: [{name: 'build', state: 'failing', url: null}], ...overrides});
