import {Fzf, type FzfResultItem} from 'fzf';
import type {PR} from './github.js';
import type {KeyPress} from './keymap.js';
import type {ListView} from './listModel.js';

/** Matched PR urls mapped to the UTF-16 indexes of the matched characters in their titles. */
export type TitleMatches = Map<string, Set<number>>;

type Word = {pr: PR; text: string; start: number};

/**
 * Fuzzy matches each space-separated term of `query` inside a single word of the title, so letters are
 * never picked from across words. A PR matches when every term does. `best` is the highest scoring url,
 * earlier PRs winning ties.
 */
function matchTitles(prs: PR[], query: string): {matches: TitleMatches; best: string | null} {
	const terms = query.split(/\s+/).filter(Boolean);
	if (!terms.length) return {matches: new Map(), best: null};
	const words = prs.flatMap(pr => [...pr.title.matchAll(/\S+/g)].map(m => ({pr, text: m[0], start: m.index})));
	const finder = new Fzf(words, {selector: (w: Word) => w.text});
	let hits: Map<PR, {score: number; positions: Set<number>}> | null = null;
	for (const term of terms) {
		const results: FzfResultItem<Word>[] = finder.find(term);
		const termHits = new Map<PR, {score: number; positions: Set<number>}>();
		for (const {item, score, positions} of results) {
			if (termHits.has(item.pr) || (hits && !hits.has(item.pr))) continue;
			const previous = hits?.get(item.pr);
			termHits.set(item.pr, {
				score: (previous?.score ?? 0) + score,
				positions: new Set([...(previous?.positions ?? []), ...[...positions].map(i => item.start + i)]),
			});
		}
		hits = termHits;
	}
	const ranked = prs.filter(pr => hits!.has(pr));
	const best = ranked.reduce<PR | null>((a, pr) => (!a || hits!.get(pr)!.score > hits!.get(a)!.score ? pr : a), null);
	return {matches: new Map(ranked.map(pr => [pr.url, hits!.get(pr)!.positions])), best: best?.url ?? null};
}

const listedPrs = (view: ListView) => view.rows.flatMap(r => (r.kind === 'pr' ? [r.pr] : []));

/** Matches `query` against the PRs listed in `view`. See `matchTitles`. */
export const searchMatches = (view: ListView, query: string) => matchTitles(listedPrs(view), query);

/**
 * The search after a key press while typing. Typing jumps the cursor to the best match, `enter` stops
 * typing (dropping an empty query), and `esc` or backspace on an empty query drops the search and puts
 * the cursor back on `origin`. `cursor` is omitted when it shouldn't move.
 */
export function typeSearch(
	query: string,
	origin: string | null,
	k: KeyPress & {backspace?: boolean; delete?: boolean},
	view: ListView,
): {query: string; typing: boolean; cursor?: string | null} {
	const cancel = {query: '', typing: false, cursor: origin};
	if (k.escape) return cancel;
	if (k.return) return {query, typing: false};
	let next = query;
	if (k.backspace || k.delete) {
		if (!query) return cancel;
		next = query.slice(0, -1);
	} else if (k.ctrl && k.input === 'u') next = '';
	else if (k.ctrl || !k.input || k.upArrow || k.downArrow || k.leftArrow || k.rightArrow || k.tab) return {query, typing: true};
	else next = query + k.input;
	const {best} = searchMatches(view, next);
	return best ? {query: next, typing: true, cursor: best} : {query: next, typing: true};
}

/** The next or previous match after the cursor in list order, wrapping around. Null when nothing matches. */
export function nextMatch(view: ListView, query: string, direction: 1 | -1): string | null {
	const order = listedPrs(view).map(p => p.url);
	const {matches} = searchMatches(view, query);
	const matched = order.filter(url => matches.has(url));
	if (!matched.length) return null;
	const at = view.cursor ? order.indexOf(view.cursor) : -1;
	const ahead = direction > 0 ? matched.find(url => order.indexOf(url) > at) : [...matched].reverse().find(url => order.indexOf(url) < at);
	return ahead ?? (direction > 0 ? matched[0] : matched[matched.length - 1]);
}

/** Splits `text` into runs of matched and unmatched characters. */
export function highlight(text: string, positions: Set<number> | undefined): {text: string; matched: boolean}[] {
	if (!positions?.size) return [{text, matched: false}];
	const runs: {text: string; matched: boolean}[] = [];
	for (let i = 0; i < text.length; i++) {
		const matched = positions.has(i);
		const last = runs[runs.length - 1];
		if (last?.matched === matched) last.text += text[i];
		else runs.push({text: text[i], matched});
	}
	return runs;
}
