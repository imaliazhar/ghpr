import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {statusLine, type StatusInput} from '../src/statusLine.js';
import {pr} from './fixtures.js';

const now = 1_000_000_000;
const base: StatusInput = {
	mode: {kind: 'normal'},
	query: '',
	matchCount: 0,
	message: null,
	loading: false,
	error: null,
	fetchedAt: now - 5 * 60_000,
	now,
};
const text = (s: Partial<StatusInput>) => statusLine({...base, ...s}).map(span => ('spinner' in span ? '*' : span.text)).join('');

describe('statusLine', () => {
	test('shows when data was last fetched by default', () => {
		assert.equal(text({}), 'updated 5m ago');
		assert.equal(text({fetchedAt: null}), '');
	});

	test('loading and failed refreshes keep the last fetch time', () => {
		assert.equal(text({loading: true}), '* refreshing · updated 5m ago');
		assert.equal(text({loading: true, fetchedAt: null}), '* loading');
		assert.equal(text({error: 'boom\ndetails'}), 'Refresh failed: boom · updated 5m ago');
	});

	test('a message replaces the default line', () => {
		assert.equal(text({message: {text: 'Archived', color: 'green'}, loading: true}), 'Archived');
	});

	test('modes take priority over messages', () => {
		const message = {text: 'Archived', color: 'green'};
		const p = pr({repo: 'acme/app', number: 7});
		assert.equal(text({mode: {kind: 'confirm', pr: p}, message}), 'Queue acme/app#7 via GitQueue? (y/n)');
		assert.equal(text({mode: {kind: 'leap', leap: {labels: new Map(), typed: ''}}, message}), 'leap: type a label · esc cancels');
		assert.equal(text({mode: {kind: 'search', origin: null}, query: 'fix', matchCount: 2, message}), '/fix   2 matches');
		assert.equal(text({mode: {kind: 'search', origin: null}, query: 'fix', matchCount: 1}), '/fix   1 match');
		assert.equal(text({mode: {kind: 'search', origin: null}, query: 'zz'}), '/zz   no matches');
		assert.equal(text({mode: {kind: 'search', origin: null}}), '/ ');
	});
});
