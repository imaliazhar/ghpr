import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {BOT_MARKER, parseBotReview, type BotReview} from './botReview.js';
import {findBranchPr, type Branch} from './git.js';
import {queuedLane} from './gitQueue.js';

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
	reviews: {author: string; state: string}[];
	waitingOn: string[];
	bot: BotReview | null;
	/** The GitQueue lane the PR is queued in, or null when it isn't queued. */
	queue: string | null;
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

async function graphql<T>(query: string): Promise<T> {
	return JSON.parse(await gh(['api', 'graphql', '-f', `query=${query}`])).data as T;
}

const str = JSON.stringify;

async function searchMine(): Promise<Ref[]> {
	const data = await graphql<{search: {nodes: {number: number; repository: {owner: {login: string}; name: string}}[]}}>(`{
		search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) {
			nodes { ... on PullRequest { number repository { owner { login } name } } }
		}
	}`);
	return data.search.nodes.map(n => ({owner: n.repository.owner.login, name: n.repository.name, number: n.number}));
}

async function findBranchPR(branch: Branch): Promise<Ref | null> {
	const data = await graphql<{repository: {pullRequests: {nodes: {number: number}[]}}}>(`{
		repository(owner: ${str(branch.owner)}, name: ${str(branch.name)}) {
			pullRequests(headRefName: ${str(branch.branch)}, states: OPEN, first: 1) { nodes { number } }
		}
	}`);
	const number = data.repository.pullRequests.nodes[0]?.number;
	return number ? {owner: branch.owner, name: branch.name, number} : null;
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
		optionalCheckCount: contexts.length - required.length,
		reviews: raw.latestReviews.nodes
			.filter(r => r.author && r.author.__typename !== 'Bot' && r.state !== 'COMMENTED')
			.map(r => ({author: r.author!.login, state: r.state})),
		waitingOn: raw.reviewRequests.nodes.flatMap(r => {
			const name = r.requestedReviewer?.name ?? r.requestedReviewer?.login;
			return name ? [name] : [];
		}),
		bot: botComment ? parseBotReview(botComment.body) : null,
		queue: queuedLane(raw.comments.nodes.map(c => ({author: c.author?.login ?? null, body: c.body}))),
	};
}

const CHUNK_SIZE = 4;

async function fetchChunk(refs: Ref[]): Promise<PR[]> {
	const fields = refs
		.map((ref, i) => `p${i}: repository(owner: ${str(ref.owner)}, name: ${str(ref.name)}) { ${prFields(ref.number)} }`)
		.join('\n');
	const data = await graphql<Record<string, {pullRequest: RawPR}>>(`{ ${fields} }`);
	return refs.map((ref, i) => toPR(ref, data[`p${i}`].pullRequest));
}

async function fetchDetails(refs: Ref[]): Promise<PR[]> {
	const chunks: Ref[][] = [];
	for (let i = 0; i < refs.length; i += CHUNK_SIZE) chunks.push(refs.slice(i, i + CHUNK_SIZE));
	return (await Promise.all(chunks.map(fetchChunk))).flat();
}

const sameRef = (a: Ref, b: Ref) =>
	a.number === b.number && a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();

export async function fetchAll(branch: Branch | null): Promise<{mine: PR[]; current: PR | null}> {
	const [mineRefs, branchRef] = await Promise.all([
		searchMine(),
		branch ? findBranchPR(branch).catch(() => null) : Promise.resolve(null),
	]);

	const refs = branchRef && !mineRefs.some(r => sameRef(r, branchRef)) ? [...mineRefs, branchRef] : mineRefs;
	const prs = await fetchDetails(refs);

	return {mine: prs.slice(0, mineRefs.length), current: branch ? findBranchPr(prs, branch) : null};
}

const MERGED_LOOKUP_CONCURRENCY = 8;

/** The merged PR for a checked out branch, or null when the branch is the default one or has no merged PR. */
async function findMergedPR(branch: Branch): Promise<Ref | null> {
	const data = await graphql<{repository: {defaultBranchRef: {name: string} | null; pullRequests: {nodes: {number: number}[]}}}>(`{
		repository(owner: ${str(branch.owner)}, name: ${str(branch.name)}) {
			defaultBranchRef { name }
			pullRequests(headRefName: ${str(branch.branch)}, states: MERGED, last: 1) { nodes { number } }
		}
	}`);
	if (data.repository.defaultBranchRef?.name === branch.branch) return null;
	const number = data.repository.pullRequests.nodes[0]?.number;
	return number ? {owner: branch.owner, name: branch.name, number} : null;
}

/** Merged PRs for the given checked out branches, skipping any that can't be looked up. */
export async function fetchMerged(branches: Branch[]): Promise<PR[]> {
	const refs: Ref[] = [];
	let next = 0;
	const worker = async () => {
		while (next < branches.length) {
			const ref = await findMergedPR(branches[next++]).catch(() => null);
			if (ref && !refs.some(r => sameRef(r, ref))) refs.push(ref);
		}
	};
	await Promise.all(Array.from({length: MERGED_LOOKUP_CONCURRENCY}, worker));
	return fetchDetails(refs);
}
