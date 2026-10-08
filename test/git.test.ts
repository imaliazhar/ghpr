import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isBranchOf} from '../src/git.js';
import {pr} from './fixtures.js';

test('matches the repo case-insensitively and the branch exactly', () => {
	const target = pr({repo: 'Acme/App', headRef: 'feat/x'});
	assert.equal(isBranchOf(target, {owner: 'acme', name: 'app', branch: 'feat/x'}), true);
	assert.equal(isBranchOf(target, {owner: 'acme', name: 'app', branch: 'Feat/X'}), false);
	assert.equal(isBranchOf(pr({repo: 'acme/other', headRef: 'feat/x'}), {owner: 'acme', name: 'app', branch: 'feat/x'}), false);
});
