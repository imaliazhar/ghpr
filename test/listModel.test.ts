import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {ARCHIVED_TOGGLE, listView, move, rowId, toggleArchived, type ListOptions} from '../src/listModel.js';
import {failing, pr, ready} from './fixtures.js';

const options = (overrides: Partial<ListOptions> = {}): ListOptions => ({tab: null, archived: new Set(), showArchived: false, ...overrides});
const ids = (prs: {url: string}[]) => prs.map(p => p.url);

describe('listView', () => {
	test('groups by status in priority order with gaps between sections', () => {
		const a = failing();
		const b = ready();
		const {rows} = listView([a, b], options(), null);
		assert.deepEqual(
			rows.map(r => r.kind),
			['header', 'pr', 'gap', 'header', 'pr'],
		);
		assert.deepEqual(rows.map(rowId).filter(Boolean), [b.url, a.url]);
	});

	test('collapses archived PRs behind a toggle and expands them on request', () => {
		const a = ready();
		const b = ready();
		const archived = new Set([b.url]);
		assert.deepEqual(listView([a, b], options({archived}), null).rows.map(rowId).filter(Boolean), [a.url, ARCHIVED_TOGGLE]);
		assert.deepEqual(listView([a, b], options({archived, showArchived: true}), null).rows.map(rowId).filter(Boolean), [a.url, ARCHIVED_TOGGLE, b.url]);
	});

	test('filters by tab', () => {
		const a = ready();
		const b = ready({repo: 'acme/other'});
		assert.deepEqual(listView([a, b], options({tab: 'acme/other'}), null).rows.map(rowId).filter(Boolean), [b.url]);
	});

	test('falls back to the first row when the cursor is not listed', () => {
		const a = ready();
		assert.equal(listView([a], options(), 'gone').cursor, a.url);
		assert.equal(listView([], options(), 'gone').cursor, null);
	});
});

describe('move', () => {
	const prs = [ready(), ready(), failing(), failing(), pr(), pr()];
	const view = (cursor: string) => listView(prs, options(), cursor);
	const [r1, r2, f1, f2, a1, a2] = ids(prs);

	test('steps across sections and clamps at the ends', () => {
		assert.equal(move(view(r2), 'down', 20), f1);
		assert.equal(move(view(r1), 'up', 20), r1);
		assert.equal(move(view(a2), 'down', 20), a2);
	});

	test('jumps to top and bottom', () => {
		assert.equal(move(view(f1), 'top', 20), r1);
		assert.equal(move(view(f1), 'bottom', 20), a2);
	});

	test('half page counts headers and gaps', () => {
		// rows: h r1 r2 gap h f1 f2 gap h a1 a2; height 8 moves 4 rows from r1 (index 1) to h (index 5) → f1
		assert.equal(move(view(r1), 'halfDown', 8), f1);
		assert.equal(move(view(a2), 'halfUp', 8), f2);
		assert.equal(move(view(a1), 'halfDown', 8), a2);
	});
});

describe('toggleArchived', () => {
	test('moves to the next PR in the same section', () => {
		const prs = [ready(), ready(), ready()];
		const [a, b, c] = ids(prs);
		const result = toggleArchived(prs, options(), b);
		assert.ok(result.archived.has(b));
		assert.equal(result.cursor, c);
		assert.equal(toggleArchived(prs, options(), c).cursor, b);
		assert.equal(toggleArchived(prs, options(), a).cursor, b);
	});

	test('moves to the next section when the PR was alone in its section', () => {
		const prs = [ready(), failing()];
		const [a, f] = ids(prs);
		assert.equal(toggleArchived(prs, options(), a).cursor, f);
	});

	test('follows the PR when unarchiving the last expanded archived PR', () => {
		const prs = [ready(), failing()];
		const [, f] = ids(prs);
		const result = toggleArchived(prs, options({archived: new Set([f]), showArchived: true}), f);
		assert.equal(result.archived.size, 0);
		assert.equal(result.cursor, f);
	});

	test('leaves the cursor alone when the PR is not in the current tab', () => {
		const prs = [ready(), ready({repo: 'acme/other'})];
		const result = toggleArchived(prs, options({tab: 'acme/app'}), prs[1].url);
		assert.ok(result.archived.has(prs[1].url));
		assert.equal('cursor' in result, false);
	});

	test('does not mutate the given archived set', () => {
		const archived = new Set<string>();
		const prs = [ready()];
		toggleArchived(prs, options({archived}), prs[0].url);
		assert.equal(archived.size, 0);
	});
});
