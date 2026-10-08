import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queuedLane} from '../src/gitQueue.js';

const bot = (body: string) => ({author: 'gitqueue-app', body});
const denied = bot('#### Queuing Denied for `highest`\n- **Blocker:** required checks are failing');

test('a PR is queued in the lane of the latest queued comment', () => {
	assert.equal(queuedLane([bot('Queued in "normal" by @me.')]), 'normal');
	assert.equal(queuedLane([bot('Queued in "low" by @me.'), denied, {author: 'me', body: '/gitqueue add highest'}]), 'low');
});

test('removal takes a PR out of the queue until it is queued again', () => {
	assert.equal(queuedLane([bot('Queued in "normal" by @me.'), bot('Removed from "normal" queue.')]), null);
	assert.equal(queuedLane([bot('Removed from "normal" queue.'), bot('Queued in "high" by @me.')]), 'high');
});

test('ignores queue comments from anyone but the GitQueue bot', () => {
	assert.equal(queuedLane([{author: 'me', body: 'Queued in "normal" by @me.'}, denied]), null);
});
