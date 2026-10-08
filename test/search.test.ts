import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {cycleMatch, editQuery, highlight, matchTitles} from '../src/search.js';
import {pr} from './fixtures.js';

describe('matchTitles', () => {
	test('fuzzy matches titles and picks the best scoring PR', () => {
		const loose = pr({title: 'make it readonly'});
		const tight = pr({title: 'fix Radio'});
		const other = pr({title: 'add theme'});
		const {matches, best} = matchTitles([loose, tight, other], 'rad');
		assert.deepEqual([...matches.keys()], [loose.url, tight.url]);
		assert.equal(best, tight.url);
		assert.deepEqual([...matches.get(tight.url)!].sort((a, b) => a - b), [4, 5, 6]);
	});

	test('never picks letters from across words', () => {
		const scattered = pr({title: 'Style Parity Check and Migration'});
		const radio = pr({title: 'Dotty Radio and RadioCard'});
		assert.deepEqual([...matchTitles([scattered, radio], 'radio').matches.keys()], [radio.url]);
	});

	test('every term must match a word', () => {
		const both = pr({title: 'Expo iOS Pipeline'});
		const one = pr({title: 'Expo Native Build'});
		const {matches} = matchTitles([both, one], 'expo pipe');
		assert.deepEqual([...matches.keys()], [both.url]);
		assert.deepEqual([...matches.get(both.url)!].sort((a, b) => a - b), [0, 1, 2, 3, 9, 10, 11, 12]);
	});

	test('matches nothing for an empty query', () => {
		assert.deepEqual(matchTitles([pr()], ''), {matches: new Map(), best: null});
	});
});

describe('editQuery', () => {
	test('types, deletes, finishes and cancels', () => {
		assert.equal(editQuery('fi', {input: 'x'}), 'fix');
		assert.equal(editQuery('fix', {input: '', delete: true}), 'fi');
		assert.equal(editQuery('', {input: '', backspace: true}), 'cancel');
		assert.equal(editQuery('fix', {input: '', return: true}), 'done');
		assert.equal(editQuery('fix', {input: '', escape: true}), 'cancel');
		assert.equal(editQuery('fix', {input: 'u', ctrl: true}), '');
		assert.equal(editQuery('fix', {input: '', upArrow: true}), 'fix');
	});
});

describe('cycleMatch', () => {
	const order = ['a', 'b', 'c', 'd'];
	const matches = new Map([['b', new Set([0])], ['d', new Set([0])]]);

	test('moves to the next or previous match in list order and wraps', () => {
		assert.equal(cycleMatch(order, matches, 'a', 1), 'b');
		assert.equal(cycleMatch(order, matches, 'b', 1), 'd');
		assert.equal(cycleMatch(order, matches, 'd', 1), 'b');
		assert.equal(cycleMatch(order, matches, 'c', -1), 'b');
		assert.equal(cycleMatch(order, matches, 'b', -1), 'd');
		assert.equal(cycleMatch(order, new Map(), 'a', 1), null);
	});
});

describe('highlight', () => {
	test('groups matched characters into runs', () => {
		assert.deepEqual(highlight('fix login', new Set([0, 1, 4])), [
			{text: 'fi', matched: true},
			{text: 'x ', matched: false},
			{text: 'l', matched: true},
			{text: 'ogin', matched: false},
		]);
		assert.deepEqual(highlight('abc', undefined), [{text: 'abc', matched: false}]);
	});
});
