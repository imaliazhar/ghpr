import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {highlight, nextMatch, searchMatches, typeSearch} from '../src/search.js';
import {pr, viewOf} from './fixtures.js';

const titled = (...titles: string[]) => titles.map(title => pr({title}));
const sorted = (positions: Set<number>) => [...positions].sort((a, b) => a - b);

describe('searchMatches', () => {
	test('fuzzy matches inside a word and picks the best scoring PR', () => {
		const [loose, tight] = titled('make it readonly', 'fix Radio', 'add theme');
		const {matches, best} = searchMatches(viewOf([loose, tight, pr({title: 'add theme'})]), 'rad');
		assert.deepEqual([...matches.keys()], [loose.url, tight.url]);
		assert.equal(best, tight.url);
		assert.deepEqual(sorted(matches.get(tight.url)!), [4, 5, 6]);
	});

	test('never picks letters from across words', () => {
		const [scattered, radio] = titled('Style Parity Check and Migration', 'Dotty Radio and RadioCard');
		assert.deepEqual([...searchMatches(viewOf([scattered, radio]), 'radio').matches.keys()], [radio.url]);
	});

	test('every term must match a word', () => {
		const [both, one] = titled('Expo iOS Pipeline', 'Expo Native Build');
		const {matches} = searchMatches(viewOf([both, one]), 'expo pipe');
		assert.deepEqual([...matches.keys()], [both.url]);
		assert.deepEqual(sorted(matches.get(both.url)!), [0, 1, 2, 3, 9, 10, 11, 12]);
	});

	test('matches nothing for an empty query', () => {
		assert.deepEqual(searchMatches(viewOf([pr()]), ''), {matches: new Map(), best: null});
	});
});

describe('typeSearch', () => {
	const [radio, theme] = titled('fix Radio', 'add theme');
	const view = viewOf([radio, theme], radio.url);
	const key = (input: string, extra = {}) => ({input, ...extra});

	test('typing jumps the cursor to the best match, and a miss leaves it alone', () => {
		assert.deepEqual(typeSearch('the', null, key('m'), view), {query: 'them', typing: true, cursor: theme.url});
		assert.deepEqual(typeSearch('zz', null, key('z'), view), {query: 'zzz', typing: true});
	});

	test('enter stops typing and keeps the query', () => {
		assert.deepEqual(typeSearch('them', null, key('', {return: true}), view), {query: 'them', typing: false});
	});

	test('esc, or backspace on an empty query, drops the search and restores the cursor', () => {
		const dropped = {query: '', typing: false, cursor: radio.url};
		assert.deepEqual(typeSearch('them', radio.url, key('', {escape: true}), view), dropped);
		assert.deepEqual(typeSearch('', radio.url, key('', {delete: true}), view), dropped);
		assert.equal(typeSearch('them', null, key('', {delete: true}), view).query, 'the');
		assert.equal(typeSearch('them', null, key('u', {ctrl: true}), view).query, '');
	});
});

describe('nextMatch', () => {
	const [a, b, c, d] = titled('alpha', 'fix one', 'gamma', 'fix two');
	const at = (cursor: string) => viewOf([a, b, c, d], cursor);

	test('moves to the next or previous match in list order and wraps', () => {
		assert.equal(nextMatch(at(a.url), 'fix', 1), b.url);
		assert.equal(nextMatch(at(b.url), 'fix', 1), d.url);
		assert.equal(nextMatch(at(d.url), 'fix', 1), b.url);
		assert.equal(nextMatch(at(c.url), 'fix', -1), b.url);
		assert.equal(nextMatch(at(b.url), 'fix', -1), d.url);
		assert.equal(nextMatch(at(a.url), 'zzz', 1), null);
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
