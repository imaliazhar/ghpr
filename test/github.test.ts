import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {BOT_MARKER} from '../src/botReview.js';
import {fetchAll, fetchMerged, type GraphQL} from '../src/github.js';

type Raw = Record<string, unknown> & {number: number; headRefName: string};

/** GitHub's raw fields for a PR in `repo`, with no labels, reviews, comments or checks unless overridden. */
const raw = (repo: string, number: number, overrides: Partial<Raw> = {}): Raw => ({
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

type Repo = {defaultBranch?: string; prs: Raw[]; merged?: Raw[]};

/**
 * Answers the queries ghpr sends: the search for your PRs, PR details, and open or merged PR lookups by
 * branch, matching repo names in any case as GitHub does. A repo missing from `repos` fails its whole query, as GitHub does. Records each query.
 */
function fakeGitHub(repos: Record<string, Repo>, mine: [repo: string, number: number][]) {
	const queries: string[] = [];
	const graphql: GraphQL = async <T,>(query: string) => {
		queries.push(query);
		if (query.includes('search(')) {
			const nodes = mine.map(([repo, number]) => {
				const [login, name] = repo.split('/');
				return {number, repository: {owner: {login}, name}};
			});
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
			if (number) result = {pullRequest: [...repo.prs, ...(repo.merged ?? [])].find(p => p.number === Number(number))};
			else if (lookup) {
				const [, branch, state] = lookup;
				const nodes = (state === 'MERGED' ? (repo.merged ?? []) : repo.prs).filter(p => p.headRefName === JSON.parse(branch));
				result = {defaultBranchRef: {name: repo.defaultBranch ?? 'main'}, pullRequests: {nodes: nodes.map(p => ({number: p.number}))}};
			}
			data[block[1] ?? 'repository'] = result;
		});
		return data as T;
	};
	return {graphql, queries};
}

const check = (name: string, fields: Record<string, unknown>, isRequired = true) => ({__typename: 'CheckRun', name, detailsUrl: `https://ci/${name}`, isRequired, ...fields});
const rollup = (...contexts: unknown[]) => ({nodes: [{commit: {statusCheckRollup: {contexts: {nodes: contexts}}}}]});

describe('fetchAll', () => {
	test("maps GitHub's fields into a PR", async () => {
		const detailed = raw('acme/app', 1, {
			reviewDecision: 'REVIEW_REQUIRED',
			labels: {nodes: [{name: 'in-review', color: 'ededed'}]},
			latestReviews: {
				nodes: [
					{author: {__typename: 'User', login: 'ana'}, state: 'APPROVED'},
					{author: {__typename: 'User', login: 'bo'}, state: 'COMMENTED'},
					{author: {__typename: 'Bot', login: 'ci'}, state: 'CHANGES_REQUESTED'},
				],
			},
			reviewRequests: {nodes: [{requestedReviewer: {login: 'cy'}}, {requestedReviewer: {name: 'web-team'}}, {requestedReviewer: null}]},
			comments: {
				nodes: [
					{author: {login: 'bot'}, body: `${BOT_MARKER}\n✅ Approved`},
					{author: {login: 'bot'}, body: `${BOT_MARKER}\n> ### Review outcome | 🔴 Requesting changes`},
					{author: {login: 'gitqueue-app'}, body: 'Queued in "normal"'},
				],
			},
			commits: rollup(
				check('build', {status: 'COMPLETED', conclusion: 'FAILURE'}),
				check('lint', {status: 'COMPLETED', conclusion: 'SKIPPED'}),
				check('e2e', {status: 'IN_PROGRESS', conclusion: null}),
				{__typename: 'StatusContext', context: 'deploy', state: 'EXPECTED', targetUrl: null, isRequired: true},
				check('docs', {status: 'COMPLETED', conclusion: 'FAILURE'}, false),
			),
		});
		const {graphql} = fakeGitHub({'acme/app': {prs: [detailed]}}, [['acme/app', 1]]);

		const {mine, current} = await fetchAll(null, graphql);

		assert.equal(current, null);
		const {bot, ...pr} = mine[0];
		assert.deepEqual(pr, {
			repo: 'acme/app',
			number: 1,
			title: 'PR 1',
			url: 'https://github.com/acme/app/pull/1',
			headRef: 'branch-1',
			headSha: 'sha-1',
			merged: false,
			reviewDecision: 'REVIEW_REQUIRED',
			labels: [{name: 'in-review', color: 'ededed'}],
			requiredChecks: [
				{name: 'build', state: 'failing', url: 'https://ci/build'},
				{name: 'lint', state: 'passed', url: 'https://ci/lint'},
				{name: 'e2e', state: 'pending', url: 'https://ci/e2e'},
				{name: 'deploy', state: 'pending', url: null},
			],
			optionalCheckCount: 1,
			reviews: [{author: 'ana', state: 'APPROVED'}],
			waitingOn: ['cy', 'web-team'],
			queue: 'normal',
		});
		assert.equal(bot?.outcome, 'changes', 'the latest bot comment wins');
	});

	test("adds the current branch's PR when it isn't one of yours, without listing it", async () => {
		const theirs = raw('acme/web', 7, {headRefName: 'fix/x'});
		const {graphql} = fakeGitHub({'acme/app': {prs: [raw('acme/app', 1)]}, 'acme/web': {prs: [theirs]}}, [['acme/app', 1]]);

		const {mine, current} = await fetchAll({owner: 'Acme', name: 'Web', branch: 'fix/x'}, graphql);

		assert.deepEqual(mine.map(p => p.number), [1]);
		assert.equal(current?.url, 'https://github.com/acme/web/pull/7');
	});

	test('finds the current branch among your PRs without fetching it twice', async () => {
		const {graphql, queries} = fakeGitHub({'acme/app': {prs: [raw('acme/app', 1, {headRefName: 'feat'})]}}, [['acme/app', 1]]);

		const {mine, current} = await fetchAll({owner: 'acme', name: 'app', branch: 'feat'}, graphql);

		assert.equal(current, mine[0]);
		assert.equal(queries.filter(q => q.includes('pullRequest(number:')).length, 1);
	});

	test('fetches details four PRs per query, in search order', async () => {
		const prs = Array.from({length: 9}, (_, i) => raw('acme/app', i + 1));
		const {graphql, queries} = fakeGitHub({'acme/app': {prs}}, prs.map(p => ['acme/app', p.number]));

		const {mine} = await fetchAll(null, graphql);

		assert.deepEqual(mine.map(p => p.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
		assert.equal(queries.filter(q => q.includes('pullRequest(number:')).length, 3);
	});
});

describe('fetchMerged', () => {
	const merged = raw('acme/app', 3, {headRefName: 'feat', merged: true});
	const repos = {'acme/app': {prs: [], merged: [merged]}, 'acme/web': {defaultBranch: 'develop', prs: []}};
	const branch = (repo: string, name: string) => ({owner: repo.split('/')[0], name: repo.split('/')[1], branch: name});

	test("looks up every branch in one query, skipping default branches and branches with no merged PR", async () => {
		const {graphql, queries} = fakeGitHub(repos, []);

		const prs = await fetchMerged([branch('acme/app', 'feat'), branch('acme/app', 'feat'), branch('acme/web', 'develop'), branch('acme/app', 'wip')], graphql);

		assert.deepEqual(prs.map(p => [p.number, p.merged]), [[3, true]]);
		assert.equal(queries.length, 2, 'one lookup and one details query');
	});

	test('skips a repo GitHub rejects without losing the rest of its batch', async () => {
		const {graphql} = fakeGitHub(repos, []);
		const prs = await fetchMerged([branch('acme/gone', 'old'), branch('acme/app', 'feat')], graphql);
		assert.deepEqual(prs.map(p => p.number), [3]);
	});
});
