import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput} from 'ink';
import {openUrl, queueForMerge, setLabel} from '../actions.js';
import {loadArchived, saveArchived} from '../archive.js';
import {loadCache, saveCache} from '../cache.js';
import {currentBranch, type Branch} from '../git.js';
import {loadLastTab, saveLastTab} from '../state.js';
import {fetchAll, type PR} from '../github.js';
import {IN_REVIEW_LABEL, TUNNEL_LABEL, hasLabel, statusOf} from '../status.js';
import {Spinner, useTerminalSize} from './common.js';
import {DetailScreen} from './DetailScreen.js';
import {ListScreen, buildRows, rowId} from './ListScreen.js';
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

export function App({all}: {all: boolean}) {
	const {exit} = useApp();
	const branch = useMemo(() => (all ? Promise.resolve(null) : currentBranch()), [all]);
	const cache = useMemo(loadCache, []);
	const startViewApplied = useRef(false);
	const hasInteracted = useRef(false);
	const {columns, rows: terminalRows} = useTerminalSize();

	const [mine, setMine] = useState<PR[]>(() => cache?.mine ?? []);
	const [fresh, setFresh] = useState(false);
	const [current, setCurrent] = useState<PR | null>(null);
	const [archived, setArchived] = useState(loadArchived);
	const [showArchived, setShowArchived] = useState(false);
	const [tab, setTab] = useState<string | null>(loadLastTab);
	const [screen, setScreen] = useState<Screen>({kind: 'list'});
	const [cursor, setCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [message, setMessage] = useState<Message | null>(null);
	const [confirm, setConfirm] = useState<PR | null>(null);

	const flash = (text: string, color = 'green') => setMessage({text, color});

	useEffect(() => {
		if (!message) return;
		const id = setTimeout(() => setMessage(null), 4000);
		return () => clearTimeout(id);
	}, [message]);

	const updateArchived = (next: Set<string>) => {
		saveArchived(next);
		setArchived(next);
	};

	const applyStartView = (b: Branch | null, prs: PR[], current: PR | null) => {
		startViewApplied.current = true;
		if (current) {
			if (prs.some(p => p.repo === current.repo)) setTab(current.repo);
			setScreen({kind: 'detail', url: current.url});
		} else if (b) setNote(`No open PR for ${b.branch}`);
	};

	useEffect(() => {
		if (!cache) return;
		branch.then(b => {
			const match = b && cache.mine.find(p => p.repo.toLowerCase() === `${b.owner}/${b.name}`.toLowerCase() && p.headRef === b.branch);
			if (match && !startViewApplied.current && !hasInteracted.current) applyStartView(b, cache.mine, match);
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
			saveCache(result.mine);

			const openUrls = new Set(result.mine.map(p => p.url));
			setArchived(prev => {
				const kept = new Set([...prev].filter(url => openUrls.has(url)));
				if (kept.size === prev.size) return prev;
				saveArchived(kept);
				return kept;
			});

			if (!startViewApplied.current && !hasInteracted.current) applyStartView(b, result.mine, result.current);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setLoading(false);
		}
	}, [branch]);

	useEffect(() => {
		load();
	}, [load]);

	const findPr = (url: string) => mine.find(p => p.url === url) ?? (current?.url === url ? current : undefined);

	const tabs = useMemo(() => buildTabs(mine, archived), [mine, archived]);
	const activeTab = tabs.some(t => t.repo === tab) ? tab : null;
	const rows = useMemo(
		() => buildRows(activeTab ? mine.filter(p => p.repo === activeTab) : mine, archived, showArchived),
		[mine, activeTab, archived, showArchived],
	);
	const ids = rows.map(rowId).filter((id): id is string => id !== null);
	const activeCursor = cursor && ids.includes(cursor) ? cursor : (ids[0] ?? null);

	const detailPr = screen.kind === 'detail' ? findPr(screen.url) : undefined;
	const focused = screen.kind === 'detail' ? detailPr : activeCursor ? mine.find(p => p.url === activeCursor) : undefined;

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
		const next = new Set(archived);
		if (next.has(pr.url)) next.delete(pr.url);
		else next.add(pr.url);
		updateArchived(next);
		flash(next.has(pr.url) ? `Archived ${pr.repo}#${pr.number}` : `Unarchived ${pr.repo}#${pr.number}`);
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
		if (input === 'q' || (key.escape && screen.kind === 'list')) return exit();
		if (input === 'R') return void load();
		if (!focused) return;
		if (input === 'w') openUrl(focused.url);
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
			<Box marginBottom={1} flexShrink={0}>
				<Text bold>My open PRs </Text>
				<Text dimColor>{mine.length || !loading ? `${mine.length} open` : ''}</Text>
				{loading && (
					<Text color="yellow">
						{'  '}
						<Spinner /> {fresh || !cache ? 'loading' : `showing results from ${age(Date.now() - cache.savedAt)}, refreshing`}
					</Text>
				)}
			</Box>
			{error && <Text color="red">{error}</Text>}
			{screen.kind === 'list' && note && <Text color="yellow">{note}</Text>}

			{screen.kind === 'detail' && detailPr ? (
				<DetailScreen
					key={detailPr.url}
					pr={detailPr}
					archived={archived.has(detailPr.url)}
					canQueue={canQueue(detailPr)}
					active={!confirm}
					onBack={() => {
						setNote(null);
						setScreen({kind: 'list'});
					}}
					onRetry={() => flash('Retry is coming in phase 2', 'gray')}
					onMissingLink={() => flash('This check has no details link', 'gray')}
				/>
			) : !loading && mine.length === 0 && !error ? (
				<Text dimColor>No open PRs 🎉</Text>
			) : (
				<ListScreen
					tabs={tabs}
					tab={activeTab}
					onTab={repo => {
						setTab(repo);
						saveLastTab(repo);
					}}
					rows={rows}
					cursor={activeCursor}
					focused={focused}
					canQueue={canQueue(focused)}
					active={!confirm}
					showArchived={showArchived}
					onMove={setCursor}
					onOpen={pr => setScreen({kind: 'detail', url: pr.url})}
					onToggleArchived={() => setShowArchived(s => !s)}
				/>
			)}

			{confirm ? (
				<Text color="yellow" bold>
					Queue {confirm.repo}#{confirm.number} via GitQueue? (y/n)
				</Text>
			) : (
				message && <Text color={message.color}>{message.text}</Text>
			)}
		</Box>
	);
}
