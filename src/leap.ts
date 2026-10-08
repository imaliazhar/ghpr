import type {KeyPress} from './keymap.js';
import {scrollStart, type ListView} from './listModel.js';

/** leap.nvim's default label order. */
const LEAP_CHARS = 'sfnjklhodweimbuyvrgtaqpcxz/SFNJKLHODWEIMBUYVRGTAQPCXZ?';

/**
 * Two-character labels in preference order. Labels for the first n² targets only use the first n
 * characters, so a short list gets labels from the easiest keys.
 */
function* labelPairs(chars: string): Generator<string> {
	for (let shell = 0; shell < chars.length; shell++) {
		for (let i = 0; i <= shell; i++) yield chars[i] + chars[shell];
		for (let j = 0; j < shell; j++) yield chars[shell] + chars[j];
	}
}

/**
 * Labels every target except the cursor, giving the best labels to the targets closest to it. Targets
 * are row positions keyed by id; ties go to the target below the cursor, like leap's forward bonus.
 */
function leapLabels(targets: Map<string, number>, cursor: string | null, chars = LEAP_CHARS): Map<string, string> {
	const at = cursor !== null ? targets.get(cursor) : undefined;
	const origin = at ?? -1;
	const ranked = [...targets]
		.filter(([id]) => id !== cursor)
		.map(([id, row]) => ({id, rank: Math.abs(row - origin) + (row < origin ? 0.5 : 0)}))
		.sort((a, b) => a.rank - b.rank);
	const pairs = labelPairs(chars);
	const labels = new Map<string, string>();
	for (const {id} of ranked) {
		const next = pairs.next();
		if (next.done) break;
		labels.set(id, next.value);
	}
	return labels;
}

/** Labels by PR url, and the label characters typed so far. */
export type Leap = {labels: Map<string, string>; typed: string};

/** Labels the PRs among the `height` rows on screen, or null when there is no other PR to jump to. */
export function startLeap(view: ListView, height: number): Leap | null {
	const start = scrollStart(view, height);
	const targets = new Map<string, number>();
	view.rows.slice(start, start + height).forEach((r, i) => r.kind === 'pr' && targets.set(r.pr.url, i));
	const labels = leapLabels(targets, view.cursor);
	return labels.size ? {labels, typed: ''} : null;
}

/**
 * Advances a leap after a key press: keeps typing, jumps to the fully typed label, or cancels on a miss.
 * Input holding several characters, as fast typing can deliver, is handled one character at a time.
 */
export function leapKey({labels, typed}: Leap, k: KeyPress & {backspace?: boolean; delete?: boolean}): {leap: Leap} | {jump: string} | 'cancel' {
	if (k.escape) return 'cancel';
	if (k.backspace || k.delete) return typed ? {leap: {labels, typed: typed.slice(0, -1)}} : 'cancel';
	if (k.ctrl || !k.input) return 'cancel';
	let next = typed;
	for (const char of k.input) {
		next += char;
		for (const [id, label] of labels) if (label === next) return {jump: id};
		if (![...labels.values()].some(label => label.startsWith(next))) return 'cancel';
	}
	return {leap: {labels, typed: next}};
}
