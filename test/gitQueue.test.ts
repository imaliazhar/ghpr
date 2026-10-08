import assert from 'node:assert/strict';
import {test} from 'node:test';
import {awaitQueueReply, queueState} from '../src/gitQueue.js';
import {pr} from './fixtures.js';

const bot = (body: string) => ({author: 'gitqueue-app', body});
const me = (body: string) => ({author: 'me', body});
const denied = bot('#### Queuing Denied for `normal`\n- **Blocker:** required checks are still pending.\n- **Next step:** wait.');
const denial = {lane: 'normal', blocker: 'required checks are still pending.'};

test('a PR is queued in the lane of the latest queued comment', () => {
	assert.deepEqual(queueState([bot('Queued in "normal" by @me.')]), {lane: 'normal', denied: null});
	assert.deepEqual(queueState([bot('Queued in "low" by @me.'), denied, me('/gitqueue add normal')]), {lane: 'low', denied: null});
});

test('removal takes a PR out of the queue until it is queued again', () => {
	assert.equal(queueState([bot('Queued in "normal" by @me.'), bot('Removed from "normal" queue.')]).lane, null);
	assert.equal(queueState([bot('Removed from "normal" queue.'), bot('Queued in "high" by @me.')]).lane, 'high');
});

test("reports GitQueue's latest denial until it is asked again", () => {
	assert.deepEqual(queueState([me('/gitqueue add normal'), denied]), {lane: null, denied: denial});
	assert.deepEqual(queueState([denied, me('/gitqueue add normal')]), {lane: null, denied: null});
	assert.deepEqual(queueState([denied, me('/gitqueue add normal'), denied]), {lane: null, denied: denial});
	assert.deepEqual(queueState([denied, bot('Queued in "normal" by @me.')]), {lane: 'normal', denied: null});
});

test('ignores queue comments from anyone but the GitQueue bot', () => {
	assert.deepEqual(queueState([me('Queued in "normal" by @me.'), me(denied.body)]), {lane: null, denied: null});
});

test('refetches until GitQueue queues or denies the PR, or gives up', async () => {
	const replies = [pr(), pr(), pr({queueDenied: denial})];
	let fetches = 0;
	const answered = await awaitQueueReply(async () => replies[fetches++], {tries: 5, delayMs: 0});
	assert.deepEqual(answered?.queueDenied, denial);
	assert.equal(fetches, 3);
	assert.equal(await awaitQueueReply(async () => pr(), {tries: 2, delayMs: 0}), null);
});
