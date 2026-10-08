import type {Checkout} from './checkouts.js';
import type {Check, PR} from './github.js';
import type {Motion} from './listModel.js';
import {IN_REVIEW_LABEL, TUNNEL_LABEL, statusOf} from './status.js';

export type KeyPress = {
	input: string;
	ctrl?: boolean;
	shift?: boolean;
	escape?: boolean;
	return?: boolean;
	tab?: boolean;
	upArrow?: boolean;
	downArrow?: boolean;
	leftArrow?: boolean;
	rightArrow?: boolean;
};

export type KeyContext = {
	screen: 'list' | 'detail';
	pr: PR | undefined;
	onArchivedToggle: boolean;
	showArchived: boolean;
	failingChecks: Check[];
	selectedCheck: Check | undefined;
	fresh: boolean;
	tmux: 'none' | 'pane' | 'popup';
	checkout: Checkout | undefined;
	scanning: boolean;
	/** A search query is set, so its matches are highlighted. */
	searching: boolean;
};

export type Command =
	| {type: 'move'; motion: Motion}
	| {type: 'selectCheck'; motion: 'up' | 'down' | 'top' | 'bottom'}
	| {type: 'tab'; delta: 1 | -1}
	| {type: 'toggleArchivedSection'}
	| {type: 'openDetail'; pr: PR}
	| {type: 'openUrl'; url: string}
	| {type: 'back'}
	| {type: 'quit'}
	| {type: 'refresh'}
	| {type: 'openPr'; pr: PR}
	| {type: 'openSession'; checkout: Checkout}
	| {type: 'composeClaude'; checkout: Checkout}
	| {type: 'sendClaude'; checkout: Checkout; text: string}
	| {type: 'confirmQueue'; pr: PR}
	| {type: 'toggleLabel'; pr: PR; label: string}
	| {type: 'toggleArchive'; pr: PR}
	| {type: 'search'}
	| {type: 'leap'}
	| {type: 'cycleMatch'; direction: 1 | -1}
	| {type: 'clearSearch'};

export type KeyResult = Command | {type: 'unavailable'; reason: string};

export type KeyItem = {key: string; label: string; enabled: boolean};

type Binding = {
	keys: string;
	label: string | ((ctx: KeyContext) => string);
	when?: (ctx: KeyContext) => boolean;
	match: (k: KeyPress) => boolean;
	/** Returns the command, or why the key can't be used right now. Called without a key press to build help. */
	run: (ctx: KeyContext, k?: KeyPress) => Command | string;
};

const plain = (...chars: string[]) => (k: KeyPress) => !k.ctrl && chars.includes(k.input);
const isUp = (k?: KeyPress) => !!k && (k.upArrow || plain('k')(k));
const isUpOrDown = (k: KeyPress) => !!(k.upArrow || k.downArrow) || plain('j', 'k')(k);
const isPrevTab = (k: KeyPress) => !!(k.leftArrow || (k.tab && k.shift)) || plain('h')(k);
const isNextTab = (k: KeyPress) => !!(k.rightArrow || (k.tab && !k.shift)) || plain('l')(k);

const onList = (ctx: KeyContext) => ctx.screen === 'list';
const onListSearching = (ctx: KeyContext) => onList(ctx) && ctx.searching;
const onDetailWithFailing = (ctx: KeyContext) => ctx.screen === 'detail' && ctx.failingChecks.length > 0;

const NO_PR = 'No PR selected';
const gitQueueUrl = (repo: string) => `https://app.gitqueue.com/install/${repo}`;
const withPr = (make: (pr: PR) => Command | string) => (ctx: KeyContext) => (ctx.pr ? make(ctx.pr) : NO_PR);

export const BOT_REVIEW_PROMPT = "Review the bot's blocking review, is it valid? Should we address or push back?";

/** Runs `make` with the focused PR's local checkout, which needs tmux. */
const withCheckout = (make: (checkout: Checkout, pr: PR) => Command | string) => (ctx: KeyContext) => {
	if (ctx.tmux === 'none') return 'Not running inside tmux';
	if (!ctx.pr) return NO_PR;
	if (ctx.checkout) return make(ctx.checkout, ctx.pr);
	return ctx.scanning ? 'Still looking for local checkouts…' : `No checkout of ${ctx.pr.headRef} in ~/Projects`;
};

const BINDINGS: Binding[] = [
	{keys: '↑/↓ j/k', label: 'move', when: onList, match: isUpOrDown, run: (_, k) => ({type: 'move', motion: isUp(k) ? 'up' : 'down'})},
	{keys: 'g/G', label: 'top / bottom', when: onList, match: plain('g', 'G'), run: (_, k) => ({type: 'move', motion: k?.input === 'G' ? 'bottom' : 'top'})},
	{
		keys: 'ctrl+u/d',
		label: 'half a screen up / down',
		when: onList,
		match: k => !!k.ctrl && (k.input === 'u' || k.input === 'd'),
		run: (_, k) => ({type: 'move', motion: k?.input === 'd' ? 'halfDown' : 'halfUp'}),
	},
	{
		keys: '←/→ h/l',
		label: 'switch repo tab',
		when: onList,
		match: k => isPrevTab(k) || isNextTab(k),
		run: (_, k) => ({type: 'tab', delta: k && isPrevTab(k) ? -1 : 1}),
	},
	{keys: 's', label: 'leap to a PR by label', when: onList, match: plain('s'), run: () => ({type: 'leap'})},
	{keys: '/', label: 'search titles', when: onList, match: plain('/'), run: () => ({type: 'search'})},
	{
		keys: 'n/N',
		label: 'next / previous match',
		when: onListSearching,
		match: plain('n', 'N'),
		run: (_, k) => ({type: 'cycleMatch', direction: k?.input === 'N' ? -1 : 1}),
	},
	{
		keys: 'enter',
		label: ctx => (ctx.onArchivedToggle ? (ctx.showArchived ? 'collapse archived' : 'expand archived') : 'PR details'),
		when: onList,
		match: k => !!k.return,
		run: ctx => (ctx.onArchivedToggle ? {type: 'toggleArchivedSection'} : withPr(pr => ({type: 'openDetail', pr}))(ctx)),
	},
	{
		keys: '↑/↓ j/k',
		label: 'select failing check',
		when: onDetailWithFailing,
		match: isUpOrDown,
		run: (_, k) => ({type: 'selectCheck', motion: isUp(k) ? 'up' : 'down'}),
	},
	{
		keys: 'g/G',
		label: 'first / last failing check',
		when: onDetailWithFailing,
		match: plain('g', 'G'),
		run: (_, k) => ({type: 'selectCheck', motion: k?.input === 'G' ? 'bottom' : 'top'}),
	},
	{
		keys: 'enter',
		label: 'open check in browser',
		when: onDetailWithFailing,
		match: k => !!k.return,
		run: ctx => (ctx.selectedCheck?.url ? {type: 'openUrl', url: ctx.selectedCheck.url} : 'This check has no details link'),
	},
	{keys: 'r', label: 'retry check', when: onDetailWithFailing, match: plain('r'), run: () => 'Retry is coming in phase 2'},
	{keys: 'O', label: 'open PR in browser', match: plain('O'), run: withPr(pr => ({type: 'openPr', pr}))},
	{
		keys: 'o',
		label: 'open tmux session for local checkout',
		match: plain('o'),
		run: withCheckout(checkout => ({type: 'openSession', checkout})),
	},
	{keys: 'c', label: 'message the claude session', match: plain('c'), run: withCheckout(checkout => ({type: 'composeClaude', checkout}))},
	{
		keys: 'B',
		label: 'ask claude about the bot review',
		match: plain('B'),
		run: withCheckout((checkout, pr) =>
			pr.bot?.outcome === 'changes' ? {type: 'sendClaude', checkout, text: BOT_REVIEW_PROMPT} : "The review bot isn't blocking",
		),
	},
	{
		keys: 'ctrl+g',
		label: "open the repo's GitQueue",
		match: k => !!k.ctrl && k.input === 'g',
		run: withPr(pr => ({type: 'openUrl', url: gitQueueUrl(pr.repo)})),
	},
	{
		keys: 'm',
		label: 'queue via GitQueue',
		match: plain('m'),
		run: ctx => {
			if (!ctx.pr) return NO_PR;
			if (!ctx.fresh) return 'Wait for fresh data before queueing';
			return statusOf(ctx.pr) === 'ready' ? {type: 'confirmQueue', pr: ctx.pr} : 'Not ready to merge';
		},
	},
	{keys: 't', label: `toggle ${TUNNEL_LABEL}`, match: plain('t'), run: withPr(pr => ({type: 'toggleLabel', pr, label: TUNNEL_LABEL}))},
	{keys: 'b', label: `toggle ${IN_REVIEW_LABEL}`, match: plain('b'), run: withPr(pr => ({type: 'toggleLabel', pr, label: IN_REVIEW_LABEL}))},
	{keys: 'a', label: 'archive / unarchive', match: plain('a'), run: withPr(pr => ({type: 'toggleArchive', pr}))},
	{keys: 'esc', label: 'back to list', when: ctx => ctx.screen === 'detail', match: k => !!k.escape, run: () => ({type: 'back'})},
	{keys: 'esc', label: 'clear search', when: onListSearching, match: k => !!k.escape, run: () => ({type: 'clearSearch'})},
	{keys: 'R', label: 'refresh', match: plain('R'), run: () => ({type: 'refresh'})},
	{
		keys: 'q',
		label: ctx => (ctx.tmux === 'popup' ? 'hide popup' : 'quit'),
		match: k => plain('q')(k) || !!k.escape,
		run: () => ({type: 'quit'}),
	},
];

const bindingsFor = (ctx: KeyContext) => BINDINGS.filter(b => !b.when || b.when(ctx));

/** The first binding for the key in this context, as a command or the reason it's unavailable. Null if no binding matches. */
export function resolveKey(ctx: KeyContext, k: KeyPress): KeyResult | null {
	const binding = bindingsFor(ctx).find(b => b.match(k));
	if (!binding) return null;
	const result = binding.run(ctx, k);
	return typeof result === 'string' ? {type: 'unavailable', reason: result} : result;
}

export function keyHelp(ctx: KeyContext): KeyItem[] {
	return bindingsFor(ctx).map(b => ({
		key: b.keys,
		label: typeof b.label === 'string' ? b.label : b.label(ctx),
		enabled: typeof b.run(ctx) !== 'string',
	}));
}
