import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {openUrl, queueForMerge, setLabel} from '../actions.js';
import {hideTmuxPopup, inTmux, inTmuxPopup, openSession, sendToClaude, sessionName} from '../tmux.js';
import {currentBranch} from '../git.js';
import {checkoutsByPr, scanCheckouts, type Checkout} from '../checkouts.js';
import type {PR} from '../github.js';
import {handleKey, helpItems, initialInput, type Effect, type InputContext} from '../input.js';
import {ARCHIVED_TOGGLE, listView, move, pruneArchived, toggleArchived} from '../listModel.js';
import {startView} from '../prData.js';
import {archivedPrs, lastTab} from '../store.js';
import {searchMatches} from '../search.js';
import {statusLine, type Message} from '../statusLine.js';
import {failingChecks, hasLabel} from '../status.js';
import {KeyHelp, Spinner, useClaudeStates, useTerminalSize} from './common.js';
import {DetailScreen} from './DetailScreen.js';
import {ListScreen} from './ListScreen.js';
import {buildTabs} from './TabBar.js';
import {usePrData} from './usePrData.js';

type Screen = {kind: 'list'} | {kind: 'detail'; url: string};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useNow(intervalMs: number) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return now;
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
	const [message, setMessage] = useState<Message | null>(null);
	const [checkouts, setCheckouts] = useState<Checkout[] | null>(null);
	const [listHeight, setListHeight] = useState(10);
	const [checkIndex, setCheckIndex] = useState(0);
	const [input, setInput] = useState(initialInput);
	const now = useNow(15_000);

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
	const matches = useMemo(() => searchMatches(view, input.query).matches, [view, input.query]);

	const checkoutMap = useMemo(() => checkoutsByPr(current ? [...mine, current] : mine, checkouts ?? []), [mine, current, checkouts]);
	const claudeStates = useClaudeStates();
	const claudeByPr = useMemo(
		() => new Map([...checkoutMap].flatMap(([url, c]) => (claudeStates.has(c.dir) ? [[url, claudeStates.get(c.dir)!] as const] : []))),
		[checkoutMap, claudeStates],
	);

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
	const inputContext: InputContext = {
		view,
		listHeight,
		keys: {
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
		},
	};

	const run = (command: Effect) => {
		switch (command.type) {
			case 'setCursor':
				return setCursor(command.id);
			case 'queue':
				return void queue(command.pr);
			case 'flash':
				return flash(command.text, command.color);
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
			case 'openUrl':
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
			case 'sendClaude': {
				const name = sessionName(command.checkout.dir);
				return void sendToClaude(command.checkout.dir, command.text).then(
					() => flash(`Sent to claude in ${name}`),
					e => flash(errorText(e), 'red'),
				);
			}
			case 'toggleLabel':
				return void toggleLabel(command.pr, command.label);
			case 'toggleArchive':
				return toggleArchive(command.pr);
		}
	};

	useInput((ch, key) => {
		hasInteracted.current = true;
		const next = handleKey(input, inputContext, {...key, input: ch});
		setInput(next.state);
		next.effects.forEach(run);
	});

	return (
		<Box flexDirection="column" width={columns} height={terminalRows - 1}>
			{screen.kind === 'detail' && detailPr ? (
				<DetailScreen
					key={detailPr.url}
					pr={detailPr}
					checkout={checkoutMap.get(detailPr.url)}
					claude={claudeByPr.get(detailPr.url)}
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
					leap={input.mode.kind === 'leap' ? input.mode.leap : null}
					checkouts={checkoutMap}
					claude={claudeByPr}
					showArchived={showArchived}
					onHeight={setListHeight}
				/>
			)}

			<Box flexShrink={0}>
				<Box flexGrow={1}>
					<Text wrap="truncate">
						{statusLine({...input, matchCount: matches.size, message, loading, error, fetchedAt, now}).map((span, i) =>
							'spinner' in span ? (
								<Text key={i} color={span.color}>
									<Spinner />
								</Text>
							) : (
								<Text key={i} color={span.color} dimColor={span.dim} bold={span.bold} inverse={span.inverse}>
									{span.text}
								</Text>
							),
						)}
					</Text>
				</Box>
				<Text dimColor> ? keys</Text>
			</Box>
			{input.mode.kind === 'help' && <KeyHelp items={helpItems(input, inputContext)} />}
		</Box>
	);
}
