import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {BOT_MARKER} from '../src/botReview.js';
import {createGitHub} from '../src/github.js';
import {fakeGitHub, raw} from './fakeGitHub.js';

const check = (name: string, fields: Record<string, unknown>, isRequired = true) => ({__typename: 'CheckRun', name, detailsUrl: `https://ci/${name}`, isRequired, ...fields});
const rollup = (...contexts: unknown[]) => ({nodes: [{commit: {statusCheckRollup: {contexts: {nodes: contexts}}}}]});

describe('pr', () => {
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
				check('gateway', {status: 'IN_PROGRESS', conclusion: null}, false),
			),
		});
		const github = createGitHub(fakeGitHub({'acme/app': {prs: [detailed]}}).graphql);

		const {bot, ...pr} = await github.pr('https://github.com/acme/app/pull/1');
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
			optionalCheckCount: 2,
			pendingOptionalCount: 1,
			reviews: [{author: 'ana', state: 'APPROVED'}],
			waitingOn: ['cy', 'web-team'],
			queue: 'normal',
			queueDenied: null,
		});
		assert.equal(bot?.outcome, 'changes', 'the latest bot comment wins');
	});

	test('fetches PRs asked for in the same tick four per query', async () => {
		const prs = Array.from({length: 9}, (_, i) => raw('acme/app', i + 1));
		const {graphql, queries} = fakeGitHub({'acme/app': {prs}});
		const github = createGitHub(graphql);

		const fetched = await Promise.all(prs.map(p => github.pr(p.url as string)));

		assert.deepEqual(fetched.map(p => p.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
		assert.equal(queries.length, 3);
		await github.pr(prs[0].url as string);
		assert.equal(queries.length, 4, 'nothing is cached between ticks');
	});

	test('fails only the PRs GitHub has no data for', async () => {
		const github = createGitHub(fakeGitHub({'acme/app': {prs: [raw('acme/app', 1)]}}).graphql);
		const [found, missing] = await Promise.allSettled([github.pr('https://github.com/acme/app/pull/1'), github.pr('https://github.com/acme/app/pull/2')]);
		assert.equal(found.status, 'fulfilled');
		assert.equal(missing.status, 'rejected');
	});
});

describe('searchMine and branchPr', () => {
	test('lists your PR urls in search order', async () => {
		const github = createGitHub(fakeGitHub({}, [['acme/app', 2], ['acme/web', 1]]).graphql);
		assert.deepEqual(await github.searchMine(), ['https://github.com/acme/app/pull/2', 'https://github.com/acme/web/pull/1']);
	});

	test("finds a branch's open PR, matching the repo in any case, and null when there is none or the repo is unknown", async () => {
		const github = createGitHub(fakeGitHub({'acme/web': {prs: [raw('acme/web', 7, {headRefName: 'fix/x'})]}}).graphql);
		assert.equal(await github.branchPr({owner: 'Acme', name: 'Web', branch: 'fix/x'}), 'https://github.com/acme/web/pull/7');
		assert.equal(await github.branchPr({owner: 'acme', name: 'web', branch: 'other'}), null);
		assert.equal(await github.branchPr({owner: 'acme', name: 'gone', branch: 'fix/x'}), null);
	});
});

describe('mergedPr', () => {
	const merged = raw('acme/app', 3, {headRefName: 'feat', merged: true});
	const repos = {'acme/app': {prs: [], merged: [merged]}, 'acme/web': {defaultBranch: 'develop', prs: []}};
	const branch = (repo: string, name: string) => ({owner: repo.split('/')[0], name: repo.split('/')[1], branch: name});

	test('looks up branches asked for in the same tick in one query, skipping default branches and branches with no merged PR', async () => {
		const {graphql, queries} = fakeGitHub(repos);
		const github = createGitHub(graphql);

		const urls = await Promise.all([branch('acme/app', 'feat'), branch('acme/web', 'develop'), branch('acme/app', 'wip')].map(github.mergedPr));

		assert.deepEqual(urls, [merged.url, null, null]);
		assert.equal(queries.length, 1);
	});

	test('looks up at most 20 branches per query', async () => {
		const {graphql, queries} = fakeGitHub(repos);
		const github = createGitHub(graphql);
		await Promise.all(Array.from({length: 21}, (_, i) => github.mergedPr(branch('acme/app', `b${i}`))));
		assert.equal(queries.length, 2);
	});

	test('skips a repo GitHub rejects without losing the rest of its batch', async () => {
		const github = createGitHub(fakeGitHub(repos).graphql);
		const urls = await Promise.all([branch('acme/gone', 'old'), branch('acme/app', 'feat')].map(github.mergedPr));
		assert.deepEqual(urls, [null, merged.url]);
	});
});
