import type {PR} from './github.js';
import {STATUS_ORDER, statusOf, type Status} from './status.js';

export const ARCHIVED_TOGGLE = 'archived-toggle';

export type Row =
	| {kind: 'gap'}
	| {kind: 'header'; status: Status; count: number}
	| {kind: 'pr'; pr: PR; archived: boolean}
	| {kind: 'archivedToggle'; count: number};

export type ListOptions = {tab: string | null; archived: Set<string>; showArchived: boolean};

/** `cursor` is always a selectable row id, or null when the list has none. */
export type ListView = {rows: Row[]; cursor: string | null};

export type Motion = 'up' | 'down' | 'top' | 'bottom' | 'halfUp' | 'halfDown';

export const rowId = (row: Row) => (row.kind === 'pr' ? row.pr.url : row.kind === 'archivedToggle' ? ARCHIVED_TOGGLE : null);

const selectableIds = (rows: Row[]) => rows.map(rowId).filter((id): id is string => id !== null);

function buildRows(prs: PR[], {tab, archived, showArchived}: ListOptions): Row[] {
	const inTab = tab ? prs.filter(p => p.repo === tab) : prs;
	const rows: Row[] = [];
	const active = inTab.filter(p => !archived.has(p.url));
	for (const status of STATUS_ORDER) {
		const group = active.filter(p => statusOf(p) === status);
		if (group.length === 0) continue;
		if (rows.length) rows.push({kind: 'gap'});
		rows.push({kind: 'header', status, count: group.length});
		rows.push(...group.map(pr => ({kind: 'pr' as const, pr, archived: false})));
	}
	const archivedPrs = inTab.filter(p => archived.has(p.url));
	if (archivedPrs.length) {
		if (rows.length) rows.push({kind: 'gap'});
		rows.push({kind: 'archivedToggle', count: archivedPrs.length});
		if (showArchived) rows.push(...archivedPrs.map(pr => ({kind: 'pr' as const, pr, archived: true})));
	}
	return rows;
}

/** Groups PRs by status, archived ones last, and falls back to the first row when `cursor` isn't listed. */
export function listView(prs: PR[], options: ListOptions, cursor: string | null): ListView {
	const rows = buildRows(prs, options);
	const ids = selectableIds(rows);
	return {rows, cursor: cursor && ids.includes(cursor) ? cursor : (ids[0] ?? null)};
}

/** The first row index shown when `height` rows fit, keeping the cursor centred where possible. */
export function scrollStart({rows, cursor}: ListView, height: number): number {
	const selected = rows.findIndex(r => rowId(r) === cursor);
	return Math.max(0, Math.min(selected - Math.floor(height / 2), rows.length - height));
}

/** Half-page motions move by `height / 2` visible rows, counting headers and gaps. */
export function move({rows, cursor}: ListView, motion: Motion, height: number): string | null {
	const ids = selectableIds(rows);
	const clamp = (i: number) => ids[Math.max(0, Math.min(ids.length - 1, i))] ?? null;
	const index = cursor ? ids.indexOf(cursor) : -1;
	switch (motion) {
		case 'up':
			return clamp(index - 1);
		case 'down':
			return clamp(index + 1);
		case 'top':
			return clamp(0);
		case 'bottom':
			return clamp(ids.length - 1);
	}
	const direction = motion === 'halfDown' ? 1 : -1;
	const from = rows.findIndex(r => rowId(r) === cursor);
	const target = Math.max(0, Math.min(rows.length - 1, from + direction * Math.max(1, Math.floor(height / 2))));
	const candidates = direction > 0 ? rows.slice(target) : rows.slice(0, target + 1).reverse();
	return selectableIds(candidates)[0] ?? clamp(direction > 0 ? ids.length - 1 : 0);
}

/**
 * Archives or unarchives `url`. The cursor moves to the next PR in the same section, else stays on the
 * toggled PR if it is still listed, else goes to the nearest remaining row. `cursor` is omitted when
 * `url` isn't in the list, so the caller keeps its own.
 */
export function toggleArchived(prs: PR[], options: ListOptions, url: string): {archived: Set<string>; cursor?: string | null} {
	const archived = new Set(options.archived);
	if (archived.has(url)) archived.delete(url);
	else archived.add(url);

	const rows = buildRows(prs, options);
	const index = rows.findIndex(r => rowId(r) === url);
	if (index < 0) return {archived};

	const next = rows[index + 1];
	if (next?.kind === 'pr') return {archived, cursor: next.pr.url};
	const previous = rows[index - 1];
	if (previous?.kind === 'pr') return {archived, cursor: previous.pr.url};

	const nextIds = selectableIds(buildRows(prs, {...options, archived}));
	if (nextIds.includes(url)) return {archived, cursor: url};
	const ids = selectableIds(rows);
	const at = ids.indexOf(url);
	return {archived, cursor: [...ids.slice(at + 1), ...ids.slice(0, at).reverse()].find(id => nextIds.includes(id)) ?? null};
}

/** Drops archived urls that are no longer listed. Returns `archived` itself when nothing changed. */
export function pruneArchived(archived: Set<string>, listed: PR[]): Set<string> {
	const urls = new Set(listed.map(p => p.url));
	const kept = new Set([...archived].filter(url => urls.has(url)));
	return kept.size === archived.size ? archived : kept;
}
