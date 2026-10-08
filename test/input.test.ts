import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {handleKey, helpItems, initialInput, type InputContext, type InputKey, type InputState} from '../src/input.js';
import {pr, ready, viewOf} from './fixtures.js';

const list = [pr({title: 'fix Radio'}), pr({title: 'add theme'}), ready({title: 'ship it'})];
const context = (cursor = list[0].url): InputContext => ({
	view: viewOf(list, cursor),
	listHeight: 20,
	keys: {
		screen: 'list',
		pr: list.find(p => p.url === cursor),
		onArchivedToggle: false,
		showArchived: false,
		failingChecks: [],
		selectedCheck: undefined,
		fresh: true,
		tmux: 'pane',
		checkout: undefined,
		scanning: false,
	},
});
const key = (input: string, extra: Partial<InputKey> = {}): InputKey => ({input, ...extra});
const esc = key('', {escape: true});

/** Presses keys in order, returning the final state and every effect. */
function press(keys: (string | InputKey)[], state: InputState = initialInput, ctx = context()) {
	const effects = [];
	for (const k of keys) {
		const next = handleKey(state, ctx, typeof k === 'string' ? key(k) : k);
		state = next.state;
		effects.push(...next.effects);
	}
	return {state, effects};
}

describe('handleKey', () => {
	test('passes key map commands through in normal mode', () => {
		assert.deepEqual(press(['j']).effects, [{type: 'move', motion: 'down'}]);
		assert.deepEqual(press(['O']).effects, [{type: 'openPr', pr: list[0]}]);
	});

	test('flashes why a key is unavailable', () => {
		assert.deepEqual(press(['m']).effects, [{type: 'flash', text: 'Not ready to merge', color: 'gray'}]);
	});

	test('help swallows keys until esc or ? closes it', () => {
		const opened = press(['?', 'q', 'j']);
		assert.equal(opened.state.mode.kind, 'help');
		assert.deepEqual(opened.effects, []);
		assert.equal(press([esc], opened.state).state.mode.kind, 'normal');
		assert.equal(press(['?'], opened.state).state.mode.kind, 'normal');
	});

	test('queue asks first and only y confirms', () => {
		const ctx = context(list[2].url);
		const asked = press(['m'], initialInput, ctx);
		assert.deepEqual(asked.state.mode, {kind: 'confirm', pr: list[2]});
		assert.deepEqual(press(['y'], asked.state, ctx).effects, [{type: 'queue', pr: list[2]}]);
		assert.deepEqual(press(['n'], asked.state, ctx), {state: initialInput, effects: [{type: 'flash', text: 'Cancelled', color: 'gray'}]});
	});

	test('keys typed into a search are text, not commands', () => {
		const {state, effects} = press(['/', 's', 'q']);
		assert.deepEqual(state, {mode: {kind: 'search', origin: list[0].url}, query: 'sq'});
		assert.ok(effects.every(e => e.type === 'setCursor'));
	});

	test('a search jumps to matches, enter keeps it highlighted, and n cycles', () => {
		const typed = press(['/', 't', 'h', 'e', 'm']);
		assert.deepEqual(typed.effects.at(-1), {type: 'setCursor', id: list[1].url});
		const done = press([key('', {return: true})], typed.state);
		assert.deepEqual(done.state, {mode: {kind: 'normal'}, query: 'them'});
		assert.deepEqual(press(['n'], done.state).effects, [{type: 'setCursor', id: list[1].url}]);
	});

	test('esc clears a finished search before it quits', () => {
		const searched = {mode: {kind: 'normal'}, query: 'them'} as const;
		assert.deepEqual(press([esc], searched), {state: initialInput, effects: []});
		assert.deepEqual(press([esc]).effects, [{type: 'quit'}]);
	});

	test('esc while typing restores the cursor', () => {
		const {state, effects} = press(['/', 't', 'h', 'e', esc]);
		assert.deepEqual(state, initialInput);
		assert.deepEqual(effects.at(-1), {type: 'setCursor', id: list[0].url});
	});

	test('leap labels PRs and jumps, and esc cancels without quitting', () => {
		const started = press(['s']);
		assert.equal(started.state.mode.kind, 'leap');
		const jumped = press(['s', 's'], started.state);
		assert.deepEqual(jumped, {state: initialInput, effects: [{type: 'setCursor', id: list[1].url}]});
		assert.deepEqual(press([esc], started.state), {state: initialInput, effects: []});
	});

	test('help reflects an active search', () => {
		const keys = (state: InputState) => helpItems(state, context()).map(i => i.key);
		assert.ok(!keys(initialInput).includes('n/N'));
		assert.ok(keys({mode: {kind: 'normal'}, query: 'x'}).includes('n/N'));
	});

	test('c writes a message for claude and enter sends it', () => {
		const checkout = {owner: 'acme', name: 'app', branch: 'b', dir: '/p/app'};
		const ctx = {...context(), keys: {...context().keys, checkout}};
		const typed = press(['c', 'h', 'x', key('', {backspace: true}), 'i there'], initialInput, ctx);
		assert.deepEqual(typed.state.mode, {kind: 'compose', checkout, text: 'hi there'});
		assert.deepEqual(press(['k'], typed.state, ctx).effects, [], 'keys are typed, not run');
		assert.deepEqual(press([key('', {return: true})], typed.state, ctx), {
			state: initialInput,
			effects: [{type: 'sendClaude', checkout, text: 'hi there'}],
		});
		assert.deepEqual(press(['!\r'], typed.state, ctx).effects, [{type: 'sendClaude', checkout, text: 'hi there!'}]);
		assert.deepEqual(press([esc], typed.state, ctx), {state: initialInput, effects: []});
		assert.deepEqual(press(['c', key('', {return: true})], initialInput, ctx), {state: initialInput, effects: []});
	});
});
