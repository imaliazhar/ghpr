import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {openUrl, queueForMerge, setLabel} from '../actions.js';
import {hideTmuxPopup, inTmux, inTmuxPopup, openSession, sessionName} from '../tmux.js';
import {currentBranch} from '../git.js';
import {checkoutsByPr, scanCheckouts, type Checkout} from '../checkouts.js';
import type {PR} from '../github.js';
import {keyHelp, resolveKey, type Command, type KeyContext} from '../keymap.js';
import {ARCHIVED_TOGGLE, listView, move, pruneArchived, toggleArchived} from '../listModel.js';
import {startView} from '../prData.js';
import {archivedPrs, lastTab} from '../store.js';
import {cycleMatch, editQuery, matchTitles} from '../search.js';
import {failingChecks, hasLabel} from '../status.js';
import {KeyHelp, Spinner, useTerminalSize} from './common.js';
import {DetailScreen} from './DetailScreen.js';
import {ListScreen} from './ListScreen.js';
import {buildTabs} from './TabBar.js';
import {usePrData} from './usePrData.js';

type Screen = {kind: 'list'} | {kind: 'detail'; url: string};
type Message = {text: string; color: string};
/** `typing` is true while keys go into the query; `origin` is the cursor to restore when it's cancelled. */
type Search = {query: string; typing: boolean; origin: string | null};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function age(ms: number) {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function Updated({at}: {at: number}) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 15_000);
		return () => clearInterval(id);
	}, []);
	return <>updated {age(now - at)}</>;
}

export function App({all}: {all: boolean}) {
	const {exit} = useApp();
	const branch = useMemo(() => (all ? Promise.resolve(null) : currentBranch()), [all]);
	const startViewApplied = useRef(false);
	const hasInteracted = useRef(false);
	const {columns, rows: terminalRows} = useTerminalSize();
	const data = usePrData(branch);
	const {mine, current, fresh, loading, error, fetchedAt, reload, patch} = data;

	const [archived, setArchived] = useState(archivedPrs.load);
	const [showArchived, setShowArchived] = useState(false);
	const [tab, setTab] = useState<string | null>(lastTab.load);
	const [screen, setScreen] = useState<Screen>({kind: 'list'});
	const [cursor, setCursor] = useState<string | null>(null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [message, setMessage] = useState<Message | null>(null);
	const [confirm, setConfirm] = useState<PR | null>(null);
	const [checkouts, setCheckouts] = useState<Checkout[] | null>(null);
	const [listHeight, setListHeight] = useState(10);
	const [checkIndex, setCheckIndex] = useState(0);
	const [search, setSearch] = useState<Search | null>(null);

	const flash = (text: string, color = 'green') => setMessage({text, color});

	useEffect(() => {
		if (!message) return;
		const id = setTimeout(() => setMessage(null), 4000);
		return () => clearTimeout(id);
	}, [message]);

	const updateArchived = (next: Set<string>) => {
		archivedPrs.save(next);
		setArchived(next);
	};

	useEffect(() => {
		if (!fresh) return;
		const kept = pruneArchived(archived, mine);
		if (kept !== archived) updateArchived(kept);
	}, [fresh, mine]);

	useEffect(() => {
		if (startViewApplied.current || hasInteracted.current) return;
		const start = startView(data);
		if (start === undefined) return;
		startViewApplied.current = true;
		if (!start) return;
		if (start.tab) setTab(start.tab);
		setScreen({kind: 'detail', url: start.url});
	}, [current, fresh]);

	const scan = useCallback(() => {
		scanCheckouts().then(setCheckouts);
	}, []);

	useEffect(scan, [scan]);

	const findPr = (url: string) => mine.find(p => p.url === url) ?? (current?.url === url ? current : undefined);

	const tabs = useMemo(() => buildTabs(mine, archived), [mine, archived]);
	const activeTab = tabs.some(t => t.repo === tab) ? tab : null;
	const listOptions = useMemo(() => ({tab: activeTab, archived, showArchived}), [activeTab, archived, showArchived]);
	const view = useMemo(() => listView(mine, listOptions, cursor), [mine, listOptions, cursor]);
	const listedPrs = useMemo(() => view.rows.flatMap(r => (r.kind === 'pr' ? [r.pr] : [])), [view.rows]);
	const matches = useMemo(() => matchTitles(listedPrs, search?.query ?? '').matches, [listedPrs, search?.query]);

	const checkoutMap = useMemo(() => checkoutsByPr(current ? [...mine, current] : mine, checkouts ?? []), [mine, current, checkouts]);

	const detailPr = screen.kind === 'detail' ? findPr(screen.url) : undefined;
	const focused = screen.kind === 'detail' ? detailPr : view.cursor ? mine.find(p => p.url === view.cursor) : undefined;

	useEffect(() => {
		if (screen.kind === 'detail' && !loading && !detailPr) setScreen({kind: 'list'});
	}, [screen, loading, detailPr]);

	const toggleLabel = async (pr: PR, label: string) => {
		const on = !hasLabel(pr, label);
		patch(pr.url, p => ({
			...p,
			labels: on ? [...p.labels, {name: label, color: 'ededed'}] : p.labels.filter(l => l.name !== label),
		}));
		flash(`${on ? '+' : '−'} ${label}`);
		try {
			await setLabel(pr, label, on);
		} catch (e) {
			flash(errorText(e), 'red');
		}
		reload();
	};

	const queue = async (pr: PR) => {
		flash(`Queueing ${pr.repo}#${pr.number}…`, 'yellow');
		try {
			await queueForMerge(pr);
			flash(`Queued ${pr.repo}#${pr.number} via GitQueue`);
		} catch (e) {
			flash(errorText(e), 'red');
		}
	};

	const toggleArchive = (pr: PR) => {
		const next = toggleArchived(mine, listOptions, pr.url);
		updateArchived(next.archived);
		if (next.cursor !== undefined) setCursor(next.cursor);
		flash(next.archived.has(pr.url) ? `Archived ${pr.repo}#${pr.number}` : `Unarchived ${pr.repo}#${pr.number}`);
	};

	const failing = detailPr ? failingChecks(detailPr) : [];
	const keyContext: KeyContext = {
		screen: screen.kind,
		pr: focused,
		onArchivedToggle: screen.kind === 'list' && view.cursor === ARCHIVED_TOGGLE,
		showArchived,
		failingChecks: failing,
		selectedCheck: failing[Math.min(checkIndex, failing.length - 1)],
		fresh,
		tmux: inTmuxPopup ? 'popup' : inTmux ? 'pane' : 'none',
		checkout: focused && checkoutMap.get(focused.url),
		scanning: checkouts === null,
		searching: !!search,
	};

	const run = (command: Command) => {
		switch (command.type) {
			case 'move': {
				const id = move(view, command.motion, listHeight);
				if (id) setCursor(id);
				return;
			}
			case 'selectCheck': {
				const last = Math.max(0, failing.length - 1);
				const index = Math.min(checkIndex, last);
				const next = {up: index - 1, down: index + 1, top: 0, bottom: last}[command.motion];
				return setCheckIndex(Math.max(0, Math.min(last, next)));
			}
			case 'tab': {
				const index = tabs.findIndex(t => t.repo === activeTab);
				const repo = tabs[(index + command.delta + tabs.length) % tabs.length].repo;
				setTab(repo);
				return lastTab.save(repo);
			}
			case 'toggleArchivedSection':
				return setShowArchived(s => !s);
			case 'openDetail':
				setCheckIndex(0);
				return setScreen({kind: 'detail', url: command.pr.url});
			case 'openCheck':
				return openUrl(command.url);
			case 'back':
				return setScreen({kind: 'list'});
			case 'quit':
				return inTmuxPopup ? hideTmuxPopup(() => exit()) : exit();
			case 'refresh':
				scan();
				return void reload();
			case 'openPr':
				return openUrl(command.pr.url);
			case 'openSession': {
				const name = sessionName(command.checkout.dir);
				flash(`Opening ${name}…`, 'yellow');
				return void openSession(command.checkout.dir).then(
					() => flash(`Switched to ${name}`),
					e => flash(errorText(e), 'red'),
				);
			}
			case 'confirmQueue':
				return setConfirm(command.pr);
			case 'toggleLabel':
				return void toggleLabel(command.pr, command.label);
			case 'toggleArchive':
				return toggleArchive(command.pr);
			case 'search':
				return setSearch({query: '', typing: true, origin: view.cursor});
			case 'cycleMatch': {
				const url = cycleMatch(listedPrs.map(p => p.url), matches, view.cursor, command.direction);
				return url ? setCursor(url) : flash('No matches', 'gray');
			}
			case 'clearSearch':
				return setSearch(null);
		}
	};

	const typeSearch = (current: Search, next: ReturnType<typeof editQuery>) => {
		if (next === 'cancel') {
			setSearch(null);
			return setCursor(current.origin);
		}
		if (next === 'done') return setSearch(current.query ? {...current, typing: false} : null);
		const found = matchTitles(listedPrs, next);
		if (found.best) setCursor(found.best);
		setSearch({...current, query: next});
	};

	useInput((input, key) => {
		hasInteracted.current = true;
		if (confirm) {
			if (input === 'y') queue(confirm);
			else flash('Cancelled', 'gray');
			setConfirm(null);
			return;
		}
		if (helpOpen) {
			if (key.escape || input === '?') setHelpOpen(false);
			return;
		}
		if (search?.typing) return typeSearch(search, editQuery(search.query, {...key, input}));
		if (input === '?') return setHelpOpen(true);
		const result = resolveKey(keyContext, {...key, input});
		if (result?.type === 'unavailable') flash(result.reason, 'gray');
		else if (result) run(result);
	});

	return (
		<Box flexDirection="column" width={columns} height={terminalRows - 1}>
			{screen.kind === 'detail' && detailPr ? (
				<DetailScreen
					key={detailPr.url}
					pr={detailPr}
					checkout={checkoutMap.get(detailPr.url)}
					selectedCheck={checkIndex}
				/>
			) : !loading && mine.length === 0 ? (
				<Text dimColor>No open PRs 🎉</Text>
			) : (
				<ListScreen
					tabs={tabs}
					tab={activeTab}
					view={view}
					matches={matches}
					checkouts={checkoutMap}
					showArchived={showArchived}
					onHeight={setListHeight}
				/>
			)}

			<Box flexShrink={0}>
				<Box flexGrow={1}>
					{confirm ? (
						<Text color="yellow" bold>
							Queue {confirm.repo}#{confirm.number} via GitQueue? (y/n)
						</Text>
					) : search?.typing ? (
						<Text wrap="truncate">
							<Text color="cyan">/{search.query}</Text>
							<Text inverse> </Text>
							{search.query && (
								<Text color={matches.size ? undefined : 'red'} dimColor={matches.size > 0}>
									{'  '}
									{matches.size ? `${matches.size} matches` : 'no matches'}
								</Text>
							)}
						</Text>
					) : message ? (
						<Text color={message.color} wrap="truncate">
							{message.text}
						</Text>
					) : loading ? (
						<Text color="yellow">
							<Spinner /> {fetchedAt ? <>refreshing · <Updated at={fetchedAt} /></> : 'loading'}
						</Text>
					) : error ? (
						<Text wrap="truncate">
							<Text color="red">Refresh failed: {error.split('\n')[0]}</Text>
							{fetchedAt && <Text dimColor> · <Updated at={fetchedAt} /></Text>}
						</Text>
					) : (
						fetchedAt && (
							<Text dimColor>
								<Updated at={fetchedAt} />
							</Text>
						)
					)}
				</Box>
				<Text dimColor> ? keys</Text>
			</Box>
			{helpOpen && <KeyHelp items={keyHelp(keyContext)} />}
		</Box>
	);
}
