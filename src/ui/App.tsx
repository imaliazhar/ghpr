import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {openUrl, queueForMerge, setLabel} from '../actions.js';
import {hideTmuxPopup, inTmux, inTmuxPopup, openSession, sessionName} from '../tmux.js';
import {currentBranch, findBranchPr} from '../git.js';
import {checkoutsByPr, scanCheckouts, type Checkout} from '../checkouts.js';
import {fetchAll, type PR} from '../github.js';
import {listView, toggleArchived} from '../listModel.js';
import {archivedPrs, lastTab, prCache} from '../store.js';
import {IN_REVIEW_LABEL, TUNNEL_LABEL, hasLabel, statusOf} from '../status.js';
import {Spinner, useTerminalSize} from './common.js';
import {DetailScreen} from './DetailScreen.js';
import {ListScreen} from './ListScreen.js';
import {buildTabs} from './TabBar.js';

type Screen = {kind: 'list'} | {kind: 'detail'; url: string};
type Message = {text: string; color: string};

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
	const cache = useMemo(prCache.load, []);
	const startViewApplied = useRef(false);
	const hasInteracted = useRef(false);
	const {columns, rows: terminalRows} = useTerminalSize();

	const [mine, setMine] = useState<PR[]>(() => cache?.mine ?? []);
	const [fresh, setFresh] = useState(false);
	const [current, setCurrent] = useState<PR | null>(null);
	const [archived, setArchived] = useState(archivedPrs.load);
	const [showArchived, setShowArchived] = useState(false);
	const [tab, setTab] = useState<string | null>(lastTab.load);
	const [screen, setScreen] = useState<Screen>({kind: 'list'});
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [fetchedAt, setFetchedAt] = useState<number | null>(() => cache?.savedAt ?? null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [message, setMessage] = useState<Message | null>(null);
	const [confirm, setConfirm] = useState<PR | null>(null);
	const [checkouts, setCheckouts] = useState<Checkout[] | null>(null);

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

	const applyStartView = (prs: PR[], current: PR | null) => {
		startViewApplied.current = true;
		if (!current) return;
		if (prs.some(p => p.repo === current.repo)) setTab(current.repo);
		setScreen({kind: 'detail', url: current.url});
	};

	useEffect(() => {
		if (!cache) return;
		branch.then(b => {
			const match = b && findBranchPr(cache.mine, b);
			if (match && !startViewApplied.current && !hasInteracted.current) applyStartView(cache.mine, match);
		});
	}, [cache, branch]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const b = await branch;
			const result = await fetchAll(b);
			setMine(result.mine);
			setCurrent(result.current);
			setFresh(true);
			setError(null);
			prCache.save(result.mine);
			setFetchedAt(Date.now());

			const openUrls = new Set(result.mine.map(p => p.url));
			setArchived(prev => {
				const kept = new Set([...prev].filter(url => openUrls.has(url)));
				if (kept.size === prev.size) return prev;
				archivedPrs.save(kept);
				return kept;
			});

			if (!startViewApplied.current && !hasInteracted.current) applyStartView(result.mine, result.current);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setLoading(false);
		}
	}, [branch]);

	useEffect(() => {
		load();
	}, [load]);

	const scan = useCallback(() => {
		scanCheckouts().then(setCheckouts);
	}, []);

	useEffect(scan, [scan]);

	const findPr = (url: string) => mine.find(p => p.url === url) ?? (current?.url === url ? current : undefined);

	const tabs = useMemo(() => buildTabs(mine, archived), [mine, archived]);
	const activeTab = tabs.some(t => t.repo === tab) ? tab : null;
	const listOptions = useMemo(() => ({tab: activeTab, archived, showArchived}), [activeTab, archived, showArchived]);
	const view = useMemo(() => listView(mine, listOptions, cursor), [mine, listOptions, cursor]);

	const checkoutMap = useMemo(() => checkoutsByPr(current ? [...mine, current] : mine, checkouts ?? []), [mine, current, checkouts]);
	const canOpen = (pr: PR | undefined) => inTmux && !!pr && checkoutMap.has(pr.url);

	const detailPr = screen.kind === 'detail' ? findPr(screen.url) : undefined;
	const focused = screen.kind === 'detail' ? detailPr : view.cursor ? mine.find(p => p.url === view.cursor) : undefined;

	useEffect(() => {
		if (screen.kind === 'detail' && !loading && !detailPr) setScreen({kind: 'list'});
	}, [screen, loading, detailPr]);

	const patchPr = (url: string, patch: (pr: PR) => PR) => {
		setMine(prs => prs.map(p => (p.url === url ? patch(p) : p)));
		setCurrent(c => (c?.url === url ? patch(c) : c));
	};

	const toggleLabel = async (pr: PR, label: string) => {
		const on = !hasLabel(pr, label);
		patchPr(pr.url, p => ({
			...p,
			labels: on ? [...p.labels, {name: label, color: 'ededed'}] : p.labels.filter(l => l.name !== label),
		}));
		flash(`${on ? '+' : '−'} ${label}`);
		try {
			await setLabel(pr, label, on);
		} catch (e) {
			flash(errorText(e), 'red');
		}
		load();
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

	const openCheckout = (pr: PR) => {
		const checkout = checkoutMap.get(pr.url);
		if (!inTmux) return flash('Not running inside tmux', 'gray');
		if (!checkout) return flash(checkouts ? `No checkout of ${pr.headRef} in ~/Projects` : 'Still looking for local checkouts…', 'gray');
		const name = sessionName(checkout.dir);
		flash(`Opening ${name}…`, 'yellow');
		openSession(checkout.dir).then(
			() => flash(`Switched to ${name}`),
			e => flash(errorText(e), 'red'),
		);
	};

	const canQueue = (pr: PR | undefined) => !!pr && fresh && statusOf(pr) === 'ready';

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
		if (input === '?' && (screen.kind === 'detail' || mine.length)) return setHelpOpen(true);
		if (key.ctrl) return;
		if (input === 'q' || (key.escape && screen.kind === 'list')) return inTmuxPopup ? hideTmuxPopup(() => exit()) : exit();
		if (input === 'R') {
			scan();
			return void load();
		}
		if (!focused) return;
		if (input === 'w') openUrl(focused.url);
		if (input === 'o') openCheckout(focused);
		if (input === 't') toggleLabel(focused, TUNNEL_LABEL);
		if (input === 'b') toggleLabel(focused, IN_REVIEW_LABEL);
		if (input === 'a') toggleArchive(focused);
		if (input === 'm') {
			if (canQueue(focused)) setConfirm(focused);
			else flash(fresh ? 'Not ready to merge' : 'Wait for fresh data before queueing', 'gray');
		}
	});

	return (
		<Box flexDirection="column" width={columns} height={terminalRows - 1}>
			{screen.kind === 'detail' && detailPr ? (
				<DetailScreen
					key={detailPr.url}
					pr={detailPr}
					canQueue={canQueue(detailPr)}
					canOpen={canOpen(detailPr)}
					checkout={checkoutMap.get(detailPr.url)}
					active={!confirm && !helpOpen}
					helpOpen={helpOpen}
					onBack={() => setScreen({kind: 'list'})}
					onRetry={() => flash('Retry is coming in phase 2', 'gray')}
					onMissingLink={() => flash('This check has no details link', 'gray')}
				/>
			) : !loading && mine.length === 0 ? (
				<Text dimColor>No open PRs 🎉</Text>
			) : (
				<ListScreen
					tabs={tabs}
					tab={activeTab}
					onTab={repo => {
						setTab(repo);
						lastTab.save(repo);
					}}
					view={view}
					focused={focused}
					canQueue={canQueue(focused)}
					canOpen={canOpen(focused)}
					checkouts={checkoutMap}
					active={!confirm && !helpOpen}
					helpOpen={helpOpen}
					showArchived={showArchived}
					onMove={setCursor}
					onOpen={pr => setScreen({kind: 'detail', url: pr.url})}
					onToggleArchived={() => setShowArchived(s => !s)}
				/>
			)}

			<Box flexShrink={0}>
				<Box flexGrow={1}>
					{confirm ? (
						<Text color="yellow" bold>
							Queue {confirm.repo}#{confirm.number} via GitQueue? (y/n)
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
		</Box>
	);
}
