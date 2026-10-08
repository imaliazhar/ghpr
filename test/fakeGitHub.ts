import type {GraphQL} from '../src/github.js';

export type Raw = Record<string, unknown> & {number: number; headRefName: string};

/** GitHub's raw fields for a PR in `repo`, with no labels, reviews, comments or checks unless overridden. */
export const raw = (repo: string, number: number, overrides: Partial<Raw> = {}): Raw => ({
	number,
	title: `PR ${number}`,
	url: `https://github.com/${repo}/pull/${number}`,
	headRefName: `branch-${number}`,
	headRefOid: `sha-${number}`,
	merged: false,
	reviewDecision: null,
	labels: {nodes: []},
	latestReviews: {nodes: []},
	reviewRequests: {nodes: []},
	comments: {nodes: []},
	commits: {nodes: [{commit: {statusCheckRollup: null}}]},
	...overrides,
});

export type Repo = {defaultBranch?: string; prs: Raw[]; merged?: Raw[]};

/**
 * Answers the queries ghpr sends: the search for your PRs, PR details, and open or merged PR lookups by
 * branch, matching repo names in any case as GitHub does. A repo missing from `repos` fails its whole query, as GitHub does. Records each query.
 * After `hold()`, each query waits to be answered until `release()` lets the oldest waiting one through.
 */
export function fakeGitHub(repos: Record<string, Repo>, mine: [repo: string, number: number][] = []) {
	const queries: string[] = [];
	const waiting: (() => void)[] = [];
	let holding = false;
	const graphql: GraphQL = async <T,>(query: string) => {
		queries.push(query);
		if (holding) await new Promise<void>(answer => waiting.push(answer));
		if (query.includes('search(')) {
			const nodes = mine.map(([repo, number]) => ({url: `https://github.com/${repo}/pull/${number}`}));
			return {search: {nodes}} as T;
		}
		const data: Record<string, unknown> = {};
		const blocks = [...query.matchAll(/(?:(\w+): )?repository\(owner: ("[^"]*"), name: ("[^"]*")\)/g)];
		blocks.forEach((block, i) => {
			const body = query.slice(block.index, blocks[i + 1]?.index);
			const name = `${JSON.parse(block[2])}/${JSON.parse(block[3])}`;
			const repo = Object.entries(repos).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
			if (!repo) throw new Error(`Could not resolve to a Repository with the name '${name}'.`);
			const number = body.match(/pullRequest\(number: (\d+)\)/)?.[1];
			const lookup = body.match(/pullRequests\(headRefName: ("[^"]*"), states: (\w+)/);
			let result: unknown;
			if (number) result = {pullRequest: [...repo.prs, ...(repo.merged ?? [])].find(p => p.number === Number(number)) ?? null};
			else if (lookup) {
				const [, branch, state] = lookup;
				const nodes = (state === 'MERGED' ? (repo.merged ?? []) : repo.prs).filter(p => p.headRefName === JSON.parse(branch));
				result = {defaultBranchRef: {name: repo.defaultBranch ?? 'main'}, pullRequests: {nodes: nodes.map(p => ({url: p.url}))}};
			}
			data[block[1] ?? 'repository'] = result;
		});
		return data as T;
	};
	return {
		graphql,
		queries,
		hold: () => {
			holding = true;
		},
		release: () => waiting.shift()?.(),
	};
}
