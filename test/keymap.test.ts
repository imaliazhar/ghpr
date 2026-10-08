import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {keyHelp, resolveKey, type KeyContext, type KeyPress} from '../src/keymap.js';
import {failing, pr, ready} from './fixtures.js';

const ctx = (overrides: Partial<KeyContext> = {}): KeyContext => ({
	screen: 'list',
	pr: pr(),
	onArchivedToggle: false,
	showArchived: false,
	failingChecks: [],
	selectedCheck: undefined,
	fresh: true,
	tmux: 'pane',
	checkout: undefined,
	scanning: false,
	searching: false,
	...overrides,
});
const key = (input: string, extra: Partial<KeyPress> = {}): KeyPress => ({input, ...extra});
const checkout = {owner: 'acme', name: 'app', branch: 'b', dir: '/p/app'};

/** One key press for each help row, built from its first listed key. */
function pressFor(keys: string): KeyPress {
	const first = keys.split(/(?<=.)[ /]/)[0];
	const named: Record<string, KeyPress> = {
		'↑': key('', {upArrow: true}),
		'←': key('', {leftArrow: true}),
		enter: key('', {return: true}),
		esc: key('', {escape: true}),
		ctrl: key('u', {ctrl: true}),
	};
	return named[first.replace(/\+.*/, '')] ?? key(first);
}

describe('resolveKey', () => {
	test('moves the list cursor with arrows, vim keys and half pages', () => {
		assert.deepEqual(resolveKey(ctx(), key('j')), {type: 'move', motion: 'down'});
		assert.deepEqual(resolveKey(ctx(), key('', {upArrow: true})), {type: 'move', motion: 'up'});
		assert.deepEqual(resolveKey(ctx(), key('G')), {type: 'move', motion: 'bottom'});
		assert.deepEqual(resolveKey(ctx(), key('d', {ctrl: true})), {type: 'move', motion: 'halfDown'});
	});

	test('ignores ctrl chords of letter keys', () => {
		assert.equal(resolveKey(ctx(), key('t', {ctrl: true})), null);
		assert.equal(resolveKey(ctx(), key('O', {ctrl: true})), null);
	});

	test('switches tabs both ways', () => {
		assert.deepEqual(resolveKey(ctx(), key('', {tab: true})), {type: 'tab', delta: 1});
		assert.deepEqual(resolveKey(ctx(), key('', {tab: true, shift: true})), {type: 'tab', delta: -1});
		assert.deepEqual(resolveKey(ctx(), key('h')), {type: 'tab', delta: -1});
	});

	test('enter expands the archived section or opens the PR', () => {
		assert.deepEqual(resolveKey(ctx({pr: undefined, onArchivedToggle: true}), key('', {return: true})), {type: 'toggleArchivedSection'});
		const p = pr();
		assert.deepEqual(resolveKey(ctx({pr: p}), key('', {return: true})), {type: 'openDetail', pr: p});
	});

	test('esc goes back from details and quits from the list', () => {
		assert.deepEqual(resolveKey(ctx({screen: 'detail'}), key('', {escape: true})), {type: 'back'});
		assert.deepEqual(resolveKey(ctx(), key('', {escape: true})), {type: 'quit'});
	});

	test('esc clears an active search before quitting', () => {
		assert.deepEqual(resolveKey(ctx({searching: true}), key('', {escape: true})), {type: 'clearSearch'});
		assert.deepEqual(resolveKey(ctx({searching: true}), key('N')), {type: 'cycleMatch', direction: -1});
		assert.equal(resolveKey(ctx(), key('n')), null);
	});

	test('explains why o is unavailable', () => {
		const reason = (c: KeyContext) => resolveKey(c, key('o'));
		assert.deepEqual(reason(ctx({tmux: 'none', checkout})), {type: 'unavailable', reason: 'Not running inside tmux'});
		assert.deepEqual(reason(ctx({scanning: true})), {type: 'unavailable', reason: 'Still looking for local checkouts…'});
		assert.match((reason(ctx()) as {reason: string}).reason, /^No checkout of/);
		assert.deepEqual(reason(ctx({checkout})), {type: 'openSession', checkout});
	});

	test('only queues ready PRs with fresh data', () => {
		const p = ready();
		assert.deepEqual(resolveKey(ctx({pr: p}), key('m')), {type: 'confirmQueue', pr: p});
		assert.deepEqual(resolveKey(ctx({pr: p, fresh: false}), key('m')), {type: 'unavailable', reason: 'Wait for fresh data before queueing'});
		assert.deepEqual(resolveKey(ctx({pr: failing()}), key('m')), {type: 'unavailable', reason: 'Not ready to merge'});
	});

	test('selects and opens failing checks on the detail screen', () => {
		const checks = [
			{name: 'a', state: 'failing' as const, url: 'https://ci/a'},
			{name: 'b', state: 'failing' as const, url: null},
		];
		const detail = (selected: number) => ctx({screen: 'detail', failingChecks: checks, selectedCheck: checks[selected]});
		assert.deepEqual(resolveKey(detail(0), key('k')), {type: 'selectCheck', motion: 'up'});
		assert.deepEqual(resolveKey(detail(0), key('', {return: true})), {type: 'openCheck', url: 'https://ci/a'});
		assert.deepEqual(resolveKey(detail(1), key('', {return: true})), {type: 'unavailable', reason: 'This check has no details link'});
		assert.equal(resolveKey(ctx({screen: 'detail'}), key('j')), null);
	});
});

describe('keyHelp', () => {
	const contexts: [string, KeyContext][] = [
		['list', ctx()],
		['list on archived toggle', ctx({pr: undefined, onArchivedToggle: true})],
		['detail with failing checks', ctx({screen: 'detail', failingChecks: [{name: 'a', state: 'failing', url: null}]})],
		['outside tmux', ctx({tmux: 'none'})],
		['list with a search', ctx({searching: true})],
	];

	for (const [name, c] of contexts) {
		test(`every listed key does what help says (${name})`, () => {
			for (const item of keyHelp(c)) {
				const result = resolveKey(c, pressFor(item.key));
				assert.ok(result, `${item.key} is listed but does nothing`);
				assert.equal(result.type !== 'unavailable', item.enabled, `${item.key} enabled state disagrees with its handler`);
			}
		});
	}

	test('labels follow the context', () => {
		const label = (c: KeyContext, k: string) => keyHelp(c).find(i => i.key === k)?.label;
		assert.equal(label(ctx({tmux: 'popup'}), 'q'), 'hide popup');
		assert.equal(label(ctx({onArchivedToggle: true, showArchived: true}), 'enter'), 'collapse archived');
	});
});
