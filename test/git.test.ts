import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findBranchPr} from '../src/git.js';
import {pr} from './fixtures.js';

test('matches the repo case-insensitively and the branch exactly', () => {
	const target = pr({repo: 'Acme/App', headRef: 'feat/x'});
	const prs = [pr({repo: 'acme/other', headRef: 'feat/x'}), target];
	assert.equal(findBranchPr(prs, {owner: 'acme', name: 'app', branch: 'feat/x'}), target);
	assert.equal(findBranchPr(prs, {owner: 'acme', name: 'app', branch: 'Feat/X'}), null);
});
