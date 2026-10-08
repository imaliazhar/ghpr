import {basename} from 'node:path';
import type {Checkout} from './checkouts.js';
import type {PR} from './github.js';
import {keyHelp, resolveKey, type Command, type KeyContext, type KeyItem} from './keymap.js';
import {editLine, type LineKey} from './lineEdit.js';
import {leapKey, startLeap, type Leap} from './leap.js';
import type {ListView} from './listModel.js';
import {nextMatch, typeSearch} from './search.js';

/** Which mode gets key presses. Only one is active at a time. */
export type Mode =
	| {kind: 'normal'}
	| {kind: 'help'}
	/** Waiting for `y` to run `effect`; any other key cancels. */
	| {kind: 'confirm'; prompt: string; effect: Effect}
	| {kind: 'leap'; leap: Leap}
	/** Typing a search query; `origin` is the cursor to restore if it's cancelled. */
	| {kind: 'search'; origin: string | null}
	/** Writing a message for the claude session of `checkout`. */
	| {kind: 'compose'; checkout: Checkout; text: string};

/** `query` is the active search, highlighted in every mode until it's cleared. Empty when there is none. */
export type InputState = {mode: Mode; query: string};

export const initialInput: InputState = {mode: {kind: 'normal'}, query: ''};

export type InputContext = {keys: Omit<KeyContext, 'searching'>; view: ListView; listHeight: number};

/** Side effects for the app to run. Mode changes are handled here and never reach it. */
export type Effect =
	| Exclude<Command, {type: 'search' | 'leap' | 'confirmQueue' | 'confirmCleanup' | 'clearSearch' | 'cycleMatch' | 'composeClaude'}>
	| {type: 'setCursor'; id: string | null}
	| {type: 'queue'; pr: PR}
	| {type: 'cleanup'; pr: PR; checkout: Checkout; discard?: boolean}
	| {type: 'flash'; text: string; color: string};

export type InputKey = LineKey;

type Result = {state: InputState; effects: Effect[]};

const keyContext = (state: InputState, ctx: InputContext): KeyContext => ({...ctx.keys, searching: !!state.query});

/** The key help for the current state, matching what `handleKey` does in normal mode. */
export const helpItems = (state: InputState, ctx: InputContext): KeyItem[] => keyHelp(keyContext(state, ctx));

const confirm = (state: InputState, prompt: string, effect: Effect): Result => ({
	state: {...state, mode: {kind: 'confirm', prompt, effect}},
	effects: [],
});
/** Asks again to clean up `checkout`, throwing away its uncommitted changes. */
export const confirmDiscard = (state: InputState, pr: PR, checkout: Checkout): InputState =>
	confirm(state, `${basename(checkout.dir)} has uncommitted changes. Discard them and clean up anyway? (y/n)`, {
		type: 'cleanup',
		pr,
		checkout,
		discard: true,
	}).state;
const flash = (text: string, color = 'gray'): Effect => ({type: 'flash', text, color});
const normal = (state: InputState, effects: Effect[] = [], query = state.query): Result => ({
	state: {mode: {kind: 'normal'}, query},
	effects,
});

/** Routes a key press to the active mode and returns the next state plus the effects to run. */
export function handleKey(state: InputState, ctx: InputContext, k: InputKey): Result {
	const {mode} = state;
	switch (mode.kind) {
		case 'confirm':
			return normal(state, k.input === 'y' ? [mode.effect] : [flash('Cancelled')]);
		case 'help':
			return k.escape || k.input === '?' ? normal(state) : {state, effects: []};
		case 'leap': {
			const step = leapKey(mode.leap, k);
			if (step === 'cancel') return normal(state);
			if ('jump' in step) return normal(state, [{type: 'setCursor', id: step.jump}]);
			return {state: {...state, mode: {kind: 'leap', leap: step.leap}}, effects: []};
		}
		case 'search': {
			const step = typeSearch(state.query, mode.origin, k, ctx.view);
			const effects: Effect[] = step.cursor !== undefined ? [{type: 'setCursor', id: step.cursor}] : [];
			return step.typing ? {state: {...state, query: step.query}, effects} : normal(state, effects, step.query);
		}
		case 'compose': {
			const step = typeMessage(mode.text, k);
			if (step === 'cancel') return normal(state);
			if ('send' in step) return normal(state, [{type: 'sendClaude', checkout: mode.checkout, text: step.send}]);
			return {state: {...state, mode: {...mode, text: step.text}}, effects: []};
		}
		case 'normal':
			return normalKey(state, ctx, k);
	}
}

/** A message after a key press (see `editLine`). Submitting an empty message cancels it. */
function typeMessage(text: string, k: InputKey): {text: string} | {send: string} | 'cancel' {
	const step = editLine(text, k, {multiline: true});
	if (step.end === 'cancel') return 'cancel';
	if (step.end === 'submit') return step.text.trim() ? {send: step.text} : 'cancel';
	return {text: step.text};
}

function normalKey(state: InputState, ctx: InputContext, k: InputKey): Result {
	if (!k.ctrl && k.input === '?') return {state: {...state, mode: {kind: 'help'}}, effects: []};
	const result = resolveKey(keyContext(state, ctx), k);
	if (!result) return {state, effects: []};
	switch (result.type) {
		case 'unavailable':
			return {state, effects: [flash(result.reason)]};
		case 'confirmQueue': {
			const {pr} = result;
			return confirm(state, `Queue ${pr.repo}#${pr.number} via GitQueue? (y/n)`, {type: 'queue', pr});
		}
		case 'confirmCleanup': {
			const {pr, checkout} = result;
			return confirm(state, `Clean up ${basename(checkout.dir)}? Closes its tmux session and deletes its branch (y/n)`, {type: 'cleanup', pr, checkout});
		}
		case 'search':
			return {state: {mode: {kind: 'search', origin: ctx.view.cursor}, query: ''}, effects: []};
		case 'clearSearch':
			return {state: {...state, query: ''}, effects: []};
		case 'cycleMatch': {
			const id = nextMatch(ctx.view, state.query, result.direction);
			return {state, effects: [id ? {type: 'setCursor', id} : flash('No matches')]};
		}
		case 'composeClaude':
			return {state: {...state, mode: {kind: 'compose', checkout: result.checkout, text: ''}}, effects: []};
		case 'leap': {
			const leap = startLeap(ctx.view, ctx.listHeight);
			return leap ? {state: {...state, mode: {kind: 'leap', leap}}, effects: []} : {state, effects: [flash('No other PRs on screen')]};
		}
		default:
			return {state, effects: [result]};
	}
}
