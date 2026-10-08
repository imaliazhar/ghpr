import type {PR} from './github.js';

export const GITQUEUE_BOT = 'gitqueue-app';

export type QueueDenial = {lane: string; blocker: string};

/**
 * Where a PR stands with GitQueue, from the bot's comments. `lane` comes from its latest `Queued in "<lane>"`
 * or `Removed from "<lane>" queue` comment, and is null when it was never queued or was removed since.
 * `denied` is its latest `Queuing Denied` reply while the PR isn't queued, and is cleared by a later
 * `/gitqueue add` that the bot hasn't answered yet. `comments` are oldest first.
 */
export function queueState(comments: {author: string | null; body: string}[]): {lane: string | null; denied: QueueDenial | null} {
	let denied: QueueDenial | null = null;
	let retried = false;
	for (const {author, body} of [...comments].reverse()) {
		if (author !== GITQUEUE_BOT) {
			if (!denied && body.trim().startsWith('/gitqueue add')) retried = true;
			continue;
		}
		const queued = body.match(/^Queued in "([^"]+)"/);
		if (queued) return {lane: queued[1], denied: null};
		if (/^Removed from "[^"]+" queue/.test(body)) return {lane: null, denied};
		const denial = body.match(/^#### Queuing Denied for `([^`]+)`/);
		if (denial && !denied && !retried) denied = {lane: denial[1], blocker: body.match(/\*\*Blocker:\*\* (.+)/)?.[1].trim() ?? 'no reason given'};
	}
	return {lane: null, denied};
}

/**
 * Refetches a PR that was just sent `/gitqueue add` until the bot has answered, by queueing or denying it.
 * Null when it hasn't answered after `tries` fetches, `delayMs` apart.
 */
export async function awaitQueueReply(refetch: () => Promise<PR>, {tries = 10, delayMs = 3000} = {}): Promise<PR | null> {
	for (let i = 0; i < tries; i++) {
		await new Promise(resolve => setTimeout(resolve, delayMs));
		const pr = await refetch().catch(() => null);
		if (pr && (pr.queue || pr.queueDenied)) return pr;
	}
	return null;
}
