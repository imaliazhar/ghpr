import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {leapKey, startLeap} from '../src/leap.js';
import {pr, viewOf} from './fixtures.js';

const prs = (n: number) => Array.from({length: n}, () => pr());
const labelsByIndex = (list: ReturnType<typeof prs>, labels: Map<string, string>) =>
	Object.fromEntries(list.flatMap((p, i) => (labels.has(p.url) ? [[i, labels.get(p.url)]] : [])));

describe('startLeap', () => {
	test('labels every PR but the cursor with unique pairs, nearest first and below before above', () => {
		const list = prs(5);
		const leap = startLeap(viewOf(list, list[2].url), 20)!;
		assert.deepEqual(labelsByIndex(list, leap.labels), {0: 'fs', 1: 'sf', 3: 'ss', 4: 'ff'});
		assert.equal(leap.typed, '');
	});

	test('a short list only uses the first few label characters', () => {
		const used = new Set([...startLeap(viewOf(prs(10)), 20)!.labels.values()].join(''));
		assert.deepEqual([...used].sort(), ['f', 'n', 's']);
	});

	test('only labels the rows on screen', () => {
		const list = prs(30);
		const leap = startLeap(viewOf(list, list[0].url), 10)!;
		assert.equal(leap.labels.size, 8);
		assert.ok(!leap.labels.has(list[20].url));
	});

	test('labels stay unique and two characters long for long lists', () => {
		const labels = [...startLeap(viewOf(prs(200)), 300)!.labels.values()];
		assert.equal(new Set(labels).size, 199);
		assert.ok(labels.every(l => l.length === 2));
	});

	test('is null when there is no other PR to jump to', () => {
		const [only] = prs(1);
		assert.equal(startLeap(viewOf([only], only.url), 20), null);
	});
});

describe('leapKey', () => {
	const leap = {labels: new Map([['a', 'ss'], ['b', 'sf'], ['c', 'fs']]), typed: ''};
	const key = (input: string, extra = {}) => ({input, ...extra});

	test('narrows by the first character and jumps on the second', () => {
		const first = leapKey(leap, key('s'));
		assert.deepEqual(first, {leap: {...leap, typed: 's'}});
		assert.deepEqual(leapKey({...leap, typed: 's'}, key('f')), {jump: 'b'});
		assert.deepEqual(leapKey(leap, key('sf')), {jump: 'b'});
	});

	test('cancels on a miss or esc, and backspace undoes a character', () => {
		assert.equal(leapKey(leap, key('x')), 'cancel');
		assert.equal(leapKey({...leap, typed: 'f'}, key('f')), 'cancel');
		assert.equal(leapKey({...leap, typed: 's'}, key('', {escape: true})), 'cancel');
		assert.deepEqual(leapKey({...leap, typed: 's'}, key('', {delete: true})), {leap});
	});
});
