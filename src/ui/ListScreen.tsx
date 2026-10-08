import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, measureElement, useInput, type DOMElement} from 'ink';
import {inTmuxPopup} from '../tmux.js';
import type {Checkout} from '../checkouts.js';
import type {PR} from '../github.js';
import {ARCHIVED_TOGGLE, move, rowId, type ListView, type Motion} from '../listModel.js';
import {STATUS_META, statusOf} from '../status.js';
import {Footer, Tags, prActions} from './common.js';
import {TabBar, type Tab} from './TabBar.js';

type Props = {
	tabs: Tab[];
	tab: string | null;
	onTab: (repo: string | null) => void;
	view: ListView;
	focused: PR | undefined;
	canQueue: boolean;
	canOpen: boolean;
	checkouts: Map<string, Checkout>;
	active: boolean;
	showArchived: boolean;
	onMove: (id: string) => void;
	onOpen: (pr: PR) => void;
	onToggleArchived: () => void;
};

export function ListScreen({tabs, tab, onTab, view, focused, canQueue, canOpen, checkouts, active, showArchived, onMove, onOpen, onToggleArchived}: Props) {
	const listRef = useRef<DOMElement>(null);
	const [listHeight, setListHeight] = useState(10);
	useEffect(() => {
		if (!listRef.current) return;
		const measured = measureElement(listRef.current).height - 2;
		if (measured > 0 && measured !== listHeight) setListHeight(measured);
	});
	const {rows, cursor} = view;
	const height = Math.max(1, listHeight - 2);

	useInput(
		(input, key) => {
			const go = (motion: Motion) => {
				const id = move(view, motion, height);
				if (id) onMove(id);
			};
			if (key.ctrl && input === 'u') return go('halfUp');
			if (key.ctrl && input === 'd') return go('halfDown');
			if (key.ctrl) return;
			if (key.upArrow || input === 'k') go('up');
			if (key.downArrow || input === 'j') go('down');
			if (input === 'g') go('top');
			if (input === 'G') go('bottom');
			if (key.return) {
				if (cursor === ARCHIVED_TOGGLE) onToggleArchived();
				else if (focused) onOpen(focused);
			}
			const tabIndex = tabs.findIndex(t => t.repo === tab);
			if (key.rightArrow || input === 'l' || (key.tab && !key.shift)) onTab(tabs[(tabIndex + 1) % tabs.length].repo);
			if (key.leftArrow || input === 'h' || (key.tab && key.shift)) onTab(tabs[(tabIndex - 1 + tabs.length) % tabs.length].repo);
		},
		{isActive: active},
	);

	const repoLabels = new Map(tabs.flatMap(t => (t.repo ? [[t.repo, t.label] as const] : [])));
	const repoWidth = tab ? 0 : Math.min(24, Math.max(...[...repoLabels.values()].map(l => l.length))) + 2;
	const selected = rows.findIndex(r => rowId(r) === cursor);
	const start = Math.max(0, Math.min(selected - Math.floor(height / 2), rows.length - height));
	const visible = rows.slice(start, start + height);

	return (
		<Box flexDirection="column" flexGrow={1}>
			<TabBar tabs={tabs} active={tab} />
			<Box ref={listRef} borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
				{start > 0 && <Text dimColor>  ↑ {start} more</Text>}
				{visible.map((row, i) => {
					const key = rowId(row) ?? `${row.kind}-${start + i}`;
					const isSel = rowId(row) === cursor;
					if (row.kind === 'gap') return <Text key={key}> </Text>;
					if (row.kind === 'header') {
						const meta = STATUS_META[row.status];
						return (
							<Text key={key} color={meta.color} bold>
								{meta.icon} {meta.label} ({row.count})
							</Text>
						);
					}
					if (row.kind === 'archivedToggle') {
						return (
							<Text key={key} dimColor bold={isSel}>
								<Text color="cyan">{isSel ? '❯ ' : '  '}</Text>
								{showArchived ? '▾' : '▸'} archived ({row.count})
							</Text>
						);
					}
					const meta = STATUS_META[statusOf(row.pr)];
					return (
						<Box key={key}>
							<Text color="cyan">{isSel ? '❯ ' : '  '}</Text>
							<Box width={2} flexShrink={0}>
								<Text color={meta.color} dimColor={row.archived}>
									{meta.icon}
								</Text>
							</Box>
							<Box width={2} flexShrink={0}>
								<Text color="cyan" dimColor>
									{checkouts.has(row.pr.url) ? '⌂' : ' '}
								</Text>
							</Box>
							{repoWidth > 0 && (
								<Box width={repoWidth} flexShrink={0}>
									<Text dimColor wrap="truncate">
										{repoLabels.get(row.pr.repo)}
									</Text>
								</Box>
							)}
							<Box flexGrow={1} flexShrink={1}>
								<Text bold={isSel} dimColor={row.archived} wrap="truncate">
									<Tags pr={row.pr} />
									{row.pr.title}
								</Text>
							</Box>
						</Box>
					);
				})}
				{start + height < rows.length && <Text dimColor>  ↓ {rows.length - start - height} more</Text>}
			</Box>
			<Footer
				items={[
					{key: '↑/↓', label: 'move'},
					{key: 'g/G', label: 'top/bottom'},
					{key: '←/→', label: 'repo'},
					{key: 'enter', label: cursor === ARCHIVED_TOGGLE ? 'expand' : 'details'},
					...prActions(focused, canQueue, canOpen),
					{key: 'R', label: 'refresh'},
					{key: 'q', label: inTmuxPopup ? 'hide' : 'quit'},
				]}
			/>
		</Box>
	);
}
