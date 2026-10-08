import assert from 'node:assert/strict';
import {test} from 'node:test';
import {editLine, type LineKey} from '../src/lineEdit.js';

const key = (input: string, extra: Partial<LineKey> = {}): LineKey => ({input, ...extra});

test('types, erases and clears text, ignoring control characters and navigation keys', () => {
	assert.deepEqual(editLine('ab', key('c\x07')), {text: 'abc'});
	assert.deepEqual(editLine('ab', key('', {backspace: true})), {text: 'a'});
	assert.deepEqual(editLine('ab', key('u', {ctrl: true})), {text: ''});
	assert.deepEqual(editLine('ab', key('', {upArrow: true})), {text: 'ab'});
});

test('esc, or erasing empty text, cancels', () => {
	assert.deepEqual(editLine('ab', key('', {escape: true})), {text: 'ab', end: 'cancel'});
	assert.deepEqual(editLine('', key('', {delete: true})), {text: '', end: 'cancel'});
});

test('enter submits, also at the end of typed input', () => {
	assert.deepEqual(editLine('ab', key('\r', {return: true})), {text: 'ab', end: 'submit'});
	assert.deepEqual(editLine('ab', key('c\r')), {text: 'abc', end: 'submit'});
	assert.deepEqual(editLine('ab', key('c\r'), {multiline: true}), {text: 'abc', end: 'submit'});
});

test('a single line submits at the first newline; multiline text keeps inner newlines', () => {
	assert.deepEqual(editLine('', key('one\ntwo')), {text: 'one', end: 'submit'});
	assert.deepEqual(editLine('', key('one\r\ntwo\rthree'), {multiline: true}), {text: 'one\ntwo\nthree'});
	assert.deepEqual(editLine('', key('one\ntwo\n'), {multiline: true}), {text: 'one\ntwo', end: 'submit'});
});
