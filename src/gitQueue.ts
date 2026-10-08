export const GITQUEUE_BOT = 'gitqueue-app';

/**
 * The GitQueue lane a PR is in, from the bot's latest `Queued in "<lane>"` or `Removed from "<lane>" queue`
 * comment. Null when it was never queued or was removed since. `comments` are oldest first.
 */
export function queuedLane(comments: {author: string | null; body: string}[]): string | null {
	for (const {author, body} of [...comments].reverse()) {
		if (author !== GITQUEUE_BOT) continue;
		const queued = body.match(/^Queued in "([^"]+)"/);
		if (queued) return queued[1];
		if (/^Removed from "[^"]+" queue/.test(body)) return null;
	}
	return null;
}
