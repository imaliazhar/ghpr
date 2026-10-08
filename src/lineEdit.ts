import type {KeyPress} from './keymap.js';

export type LineKey = KeyPress & {backspace?: boolean; delete?: boolean};

/** The text after a key press, and whether that key submitted or cancelled it. */
export type LineEdit = {text: string; end?: 'submit' | 'cancel'};

/**
 * Edits `text` with a key press. `esc`, or backspace on empty text, cancels. `enter` submits, also when it
 * arrives at the end of the same input as typed text. A newline inside pasted input submits a single line
 * at that newline, and is kept in `multiline` text, so only a trailing one submits it.
 */
export function editLine(text: string, k: LineKey, {multiline = false} = {}): LineEdit {
	if (k.escape) return {text, end: 'cancel'};
	if (k.return) return {text, end: 'submit'};
	if (k.backspace || k.delete) return text ? {text: text.slice(0, -1)} : {text, end: 'cancel'};
	if (k.ctrl && k.input === 'u') return {text: ''};
	if (k.ctrl || !k.input || k.upArrow || k.downArrow || k.leftArrow || k.rightArrow || k.tab) return {text};
	const lines = k.input.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[\x00-\x1f\x7f]/g, ''));
	if (lines.length === 1) return {text: text + lines[0]};
	if (!multiline) return {text: text + lines[0], end: 'submit'};
	const submitted = lines.at(-1) === '';
	const typed = (submitted ? lines.slice(0, -1) : lines).join('\n');
	return submitted ? {text: text + typed, end: 'submit'} : {text: text + typed};
}
