import {execFile} from 'node:child_process';
import DataLoader from 'dataloader';
import {promisify} from 'node:util';
import {BOT_MARKER, parseBotReview, type BotReview} from './botReview.js';
import type {Branch} from './git.js';
import {queueState, type QueueDenial} from './gitQueue.js';

const run = promisify(execFile);

export type Check = {name: string; state: 'failing' | 'pending' | 'passed'; url: string | null};

export type PR = {
	repo: string;
	number: number;
	title: string;
	url: string;
	headRef: string;
	/** The commit the PR's branch points at on GitHub. */
	headSha: string;
	merged: boolean;
	reviewDecision: string | null;
	labels: {name: string; color: string}[];
	requiredChecks: Check[];
	optionalCheckCount: number;
	/** Optional checks still running, which GitQueue waits for too. */
	pendingOptionalCount: number;
	reviews: {author: string; state: string}[];
	waitingOn: string[];
	bot: BotReview | null;
	/** The GitQueue lane the PR is queued in, or null when it isn't queued. */
	queue: string | null;
	/** GitQueue's latest refusal to queue the PR, while it isn't queued and hasn't been asked again. */
	queueDenied: QueueDenial | null;
};

type Ref = {owner: string; name: string; number: number};

type Context =
	| {__typename: 'CheckRun'; name: string; status: string; conclusion: string | null; detailsUrl: string | null; isRequired: boolean}
	| {__typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; isRequired: boolean};

type RawPR = {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	headRefOid: string;
	merged: boolean;
	reviewDecision: string | null;
	labels: {nodes: {name: string; color: string}[]};
	latestReviews: {nodes: {author: {__typename: string; login: string} | null; state: string}[]};
	reviewRequests: {nodes: {requestedReviewer: {login?: string; name?: string} | null}[]};
	comments: {nodes: {author: {login: string} | null; body: string}[]};
	commits: {nodes: {commit: {statusCheckRollup: {contexts: {nodes: Context[]}} | null}}[]};
};

const PASSING = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export async function gh(args: string[]): Promise<string> {
	try {
		const {stdout} = await run('gh', args, {maxBuffer: 64 * 1024 * 1024});
		return stdout;
	} catch (e) {
		const stderr = (e as {stderr?: string}).stderr?.trim();
		throw new Error(stderr || (e instanceof Error ? e.message : String(e)));
	}
}

/** Runs a GraphQL query against GitHub and returns its `data`. */
export type GraphQL = <T>(query: string) => Promise<T>;

const ghGraphql: GraphQL = async query => JSON.parse(await gh(['api', 'graphql', '-f', `query=${query}`])).data;

const str = JSON.stringify;

/** The repo and number a PR url points at. */
function refOf(url: string): Ref {
	const [owner, name, , number] = new URL(url).pathname.split('/').filter(Boolean);
	return {owner, name, number: Number(number)};
}

async function searchMine(graphql: GraphQL): Promise<string[]> {
	const data = await graphql<{search: {nodes: {url: string}[]}}>(`{
		search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) {
			nodes { ... on PullRequest { url } }
		}
	}`);
	return data.search.nodes.map(n => n.url);
}

async function findBranchPr(graphql: GraphQL, branch: Branch): Promise<string | null> {
	const data = await graphql<{repository: {pullRequests: {nodes: {url: string}[]}}}>(`{
		repository(owner: ${str(branch.owner)}, name: ${str(branch.name)}) {
			pullRequests(headRefName: ${str(branch.branch)}, states: OPEN, first: 1) { nodes { url } }
		}
	}`);
	return data.repository.pullRequests.nodes[0]?.url ?? null;
}

function prFields(number: number) {
	return `pullRequest(number: ${number}) {
		number title url headRefName headRefOid merged reviewDecision
		labels(first: 30) { nodes { name color } }
		latestReviews(first: 30) { nodes { author { __typename login } state } }
		reviewRequests(first: 30) { nodes { requestedReviewer {
			... on User { login } ... on Team { name } ... on Bot { login } ... on Mannequin { login }
		} } }
		comments(last: 30) { nodes { author { login } body } }
		commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
			__typename
			... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: ${number}) }
			... on StatusContext { context state targetUrl isRequired(pullRequestNumber: ${number}) }
		} } } } } }
	}`;
}

function toCheck(c: Context): Check {
	if (c.__typename === 'CheckRun') {
		const state = c.status !== 'COMPLETED' ? 'pending' : PASSING.has(c.conclusion ?? '') ? 'passed' : 'failing';
		return {name: c.name, state, url: c.detailsUrl};
	}
	const state = c.state === 'SUCCESS' ? 'passed' : c.state === 'PENDING' || c.state === 'EXPECTED' ? 'pending' : 'failing';
	return {name: c.context, state, url: c.targetUrl};
}

function toPR(ref: Ref, raw: RawPR): PR {
	const contexts = raw.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
	const required = contexts.filter(c => c.isRequired);
	const optional = contexts.filter(c => !c.isRequired).map(toCheck);
	const queue = queueState(raw.comments.nodes.map(c => ({author: c.author?.login ?? null, body: c.body})));
	const botComment = raw.comments.nodes.filter(c => c.body.includes(BOT_MARKER)).at(-1);

	return {
		repo: `${ref.owner}/${ref.name}`,
		number: raw.number,
		title: raw.title,
		url: raw.url,
		headRef: raw.headRefName,
		headSha: raw.headRefOid,
		merged: raw.merged,
		reviewDecision: raw.reviewDecision,
		labels: raw.labels.nodes,
		requiredChecks: required.map(toCheck),
		optionalCheckCount: optional.length,
		pendingOptionalCount: optional.filter(c => c.state === 'pending').length,
		reviews: raw.latestReviews.nodes
			.filter(r => r.author && r.author.__typename !== 'Bot' && r.state !== 'COMMENTED')
			.map(r => ({author: r.author!.login, state: r.state})),
		waitingOn: raw.reviewRequests.nodes.flatMap(r => {
			const name = r.requestedReviewer?.name ?? r.requestedReviewer?.login;
			return name ? [name] : [];
		}),
		bot: botComment ? parseBotReview(botComment.body) : null,
		queue: queue.lane,
		queueDenied: queue.denied,
	};
}

async function fetchPrs(graphql: GraphQL, urls: readonly string[]): Promise<(PR | Error)[]> {
	const refs = urls.map(refOf);
	const fields = refs
		.map((ref, i) => `p${i}: repository(owner: ${str(ref.owner)}, name: ${str(ref.name)}) { ${prFields(ref.number)} }`)
		.join('\n');
	const data = await graphql<Record<string, {pullRequest: RawPR | null} | null>>(`{ ${fields} }`);
	return refs.map((ref, i) => {
		const raw = data[`p${i}`]?.pullRequest;
		return raw ? toPR(ref, raw) : new Error(`${urls[i]} not found`);
	});
}

/** The merged PR url for each branch, or null when the branch is its repo's default one or has no merged PR. */
async function findMergedPrs(graphql: GraphQL, branches: readonly Branch[]): Promise<(string | null)[]> {
	const fields = branches
		.map(
			(b, i) => `b${i}: repository(owner: ${str(b.owner)}, name: ${str(b.name)}) {
				defaultBranchRef { name }
				pullRequests(headRefName: ${str(b.branch)}, states: MERGED, last: 1) { nodes { url } }
			}`,
		)
		.join('\n');
	type Lookup = {defaultBranchRef: {name: string} | null; pullRequests: {nodes: {url: string}[]}} | null;
	const data = await graphql<Record<string, Lookup>>(`{ ${fields} }`);
	return branches.map((b, i) => {
		const repo = data[`b${i}`];
		return (repo && repo.defaultBranchRef?.name !== b.branch && repo.pullRequests.nodes[0]?.url) || null;
	});
}

const PR_BATCH_SIZE = 4;
const MERGED_BATCH_SIZE = 20;

export type GitHub = {
	/** Urls of your open PRs, most recently updated first. */
	searchMine(): Promise<string[]>;
	/** The url of the open PR for `branch`, or null when there is none or its repo can't be looked up. */
	branchPr(branch: Branch): Promise<string | null>;
	/** The PR at `url` as it is on GitHub now. Calls made in the same tick share queries of up to 4 PRs. */
	pr(url: string): Promise<PR>;
	/**
	 * The url of the merged PR for a checked out branch, or null when the branch is its repo's default one, has no
	 * merged PR, or can't be looked up. Calls made in the same tick share queries of up to 20 branches; a query
	 * GitHub rejects, such as one with a deleted repo, is retried one branch at a time.
	 */
	mergedPr(branch: Branch): Promise<string | null>;
};

export function createGitHub(graphql: GraphQL = ghGraphql): GitHub {
	const prs = new DataLoader<string, PR>(urls => fetchPrs(graphql, urls), {maxBatchSize: PR_BATCH_SIZE, cache: false});
	const lookOne = (branch: Branch) => findMergedPrs(graphql, [branch]).then(([url]) => url, () => null);
	const merged = new DataLoader<Branch, string | null>(
		branches => findMergedPrs(graphql, branches).catch(() => Promise.all(branches.map(lookOne))),
		{maxBatchSize: MERGED_BATCH_SIZE, cache: false},
	);
	return {
		searchMine: () => searchMine(graphql),
		branchPr: branch => findBranchPr(graphql, branch).catch(() => null),
		pr: url => prs.load(url),
		mergedPr: branch => merged.load(branch),
	};
}
