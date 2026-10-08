import type {PR} from './github.js';
import {keyHelp, resolveKey, type Command, type KeyContext, type KeyItem, type KeyPress} from './keymap.js';
import {leapKey, startLeap, type Leap} from './leap.js';
import type {ListView} from './listModel.js';
import {nextMatch, typeSearch} from './search.js';

/** Which mode gets key presses. Only one is active at a time. */
export type Mode =
	| {kind: 'normal'}
	| {kind: 'help'}
	| {kind: 'confirm'; pr: PR}
	| {kind: 'leap'; leap: Leap}
	/** Typing a search query; `origin` is the cursor to restore if it's cancelled. */
	| {kind: 'search'; origin: string | null};

/** `query` is the active search, highlighted in every mode until it's cleared. Empty when there is none. */
export type InputState = {mode: Mode; query: string};

export const initialInput: InputState = {mode: {kind: 'normal'}, query: ''};

export type InputContext = {keys: Omit<KeyContext, 'searching'>; view: ListView; listHeight: number};

/** Side effects for the app to run. Mode changes are handled here and never reach it. */
export type Effect =
	| Exclude<Command, {type: 'search' | 'leap' | 'confirmQueue' | 'clearSearch' | 'cycleMatch'}>
	| {type: 'setCursor'; id: string | null}
	| {type: 'queue'; pr: PR}
	| {type: 'flash'; text: string; color: string};

export type InputKey = KeyPress & {backspace?: boolean; delete?: boolean};

type Result = {state: InputState; effects: Effect[]};

const keyContext = (state: InputState, ctx: InputContext): KeyContext => ({...ctx.keys, searching: !!state.query});

/** The key help for the current state, matching what `handleKey` does in normal mode. */
export const helpItems = (state: InputState, ctx: InputContext): KeyItem[] => keyHelp(keyContext(state, ctx));

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
			return normal(state, k.input === 'y' ? [{type: 'queue', pr: mode.pr}] : [flash('Cancelled')]);
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
		case 'normal':
			return normalKey(state, ctx, k);
	}
}

function normalKey(state: InputState, ctx: InputContext, k: InputKey): Result {
	if (!k.ctrl && k.input === '?') return {state: {...state, mode: {kind: 'help'}}, effects: []};
	const result = resolveKey(keyContext(state, ctx), k);
	if (!result) return {state, effects: []};
	switch (result.type) {
		case 'unavailable':
			return {state, effects: [flash(result.reason)]};
		case 'confirmQueue':
			return {state: {...state, mode: {kind: 'confirm', pr: result.pr}}, effects: []};
		case 'search':
			return {state: {mode: {kind: 'search', origin: ctx.view.cursor}, query: ''}, effects: []};
		case 'clearSearch':
			return {state: {...state, query: ''}, effects: []};
		case 'cycleMatch': {
			const id = nextMatch(ctx.view, state.query, result.direction);
			return {state, effects: [id ? {type: 'setCursor', id} : flash('No matches')]};
		}
		case 'leap': {
			const leap = startLeap(ctx.view, ctx.listHeight);
			return leap ? {state: {...state, mode: {kind: 'leap', leap}}, effects: []} : {state, effects: [flash('No other PRs on screen')]};
		}
		default:
			return {state, effects: [result]};
	}
}
