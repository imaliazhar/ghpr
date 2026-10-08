import type {Mode} from './input.js';
import {sessionName} from './tmux.js';

export type Message = {text: string; color: string};

export type Span = {text: string; color?: string; dim?: boolean; bold?: boolean; inverse?: boolean} | {spinner: true; color: string};

export type StatusInput = {
	mode: Mode;
	query: string;
	matchCount: number;
	message: Message | null;
	loading: boolean;
	error: string | null;
	fetchedAt: number | null;
	now: number;
};

export function age(ms: number) {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * The status line, highest priority first: a pending confirmation, leap, search typing, a message being
 * written for claude, a flashed message, loading, a failed refresh, and otherwise when data was last fetched.
 */
export function statusLine(s: StatusInput): Span[] {
	const updated = s.fetchedAt ? `updated ${age(s.now - s.fetchedAt)}` : null;
	if (s.mode.kind === 'confirm') return [{text: s.mode.prompt, color: 'yellow', bold: true}];
	if (s.mode.kind === 'leap') return [{text: 'leap: type a label · esc cancels', color: 'cyan'}];
	if (s.mode.kind === 'search') {
		const spans: Span[] = [{text: `/${s.query}`, color: 'cyan'}, {text: ' ', inverse: true}];
		if (s.query) spans.push(s.matchCount ? {text: `  ${s.matchCount} ${s.matchCount === 1 ? 'match' : 'matches'}`, dim: true} : {text: '  no matches', color: 'red'});
		return spans;
	}
	if (s.mode.kind === 'compose') {
		return [
			{text: `claude@${sessionName(s.mode.checkout.dir)} ❯ `, color: 'magenta'},
			{text: s.mode.text},
			{text: ' ', inverse: true},
			{text: '  enter sends · esc cancels', dim: true},
		];
	}
	if (s.message) return [{text: s.message.text, color: s.message.color}];
	if (s.loading) return [{spinner: true, color: 'yellow'}, {text: updated ? ` refreshing · ${updated}` : ' loading', color: 'yellow'}];
	if (s.error) {
		const spans: Span[] = [{text: `Refresh failed: ${s.error.split('\n')[0]}`, color: 'red'}];
		if (updated) spans.push({text: ` · ${updated}`, dim: true});
		return spans;
	}
	return updated ? [{text: updated, dim: true}] : [];
}
