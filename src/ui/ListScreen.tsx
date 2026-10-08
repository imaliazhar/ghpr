import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, measureElement, type DOMElement} from 'ink';
import type {Checkout} from '../checkouts.js';
import {rowId, type ListView} from '../listModel.js';
import {highlight, type TitleMatches} from '../search.js';
import {STATUS_META, statusOf} from '../status.js';
import {TabBar, type Tab} from './TabBar.js';

type Props = {
	tabs: Tab[];
	tab: string | null;
	view: ListView;
	matches: TitleMatches;
	checkouts: Map<string, Checkout>;
	showArchived: boolean;
	/** Reports how many rows fit, for half-page motions. */
	onHeight: (rows: number) => void;
};

export function ListScreen({tabs, tab, view, matches, checkouts, showArchived, onHeight}: Props) {
	const listRef = useRef<DOMElement>(null);
	const [listHeight, setListHeight] = useState(10);
	useEffect(() => {
		if (!listRef.current) return;
		const measured = measureElement(listRef.current).height - 2;
		if (measured > 0 && measured !== listHeight) setListHeight(measured);
	});
	const {rows, cursor} = view;
	const height = Math.max(1, listHeight - 2);
	useEffect(() => onHeight(height), [height]);

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
									{highlight(row.pr.title, matches.get(row.pr.url)).map((run, j) =>
										run.matched ? (
											<Text key={j} color="yellow" bold>
												{run.text}
											</Text>
										) : (
											run.text
										),
									)}
								</Text>
							</Box>
						</Box>
					);
				})}
				{start + height < rows.length && <Text dimColor>  ↓ {rows.length - start - height} more</Text>}
			</Box>
		</Box>
	);
}
