import assert from 'node:assert/strict';
import {test} from 'node:test';
import {statusOf} from '../src/status.js';
import {failing, ready} from './fixtures.js';

test('an approved PR is pending, not ready, while an optional check is still running', () => {
	assert.equal(statusOf(ready()), 'ready');
	assert.equal(statusOf(ready({pendingOptionalCount: 1})), 'pending');
	assert.equal(statusOf(failing({pendingOptionalCount: 1})), 'failing');
});
