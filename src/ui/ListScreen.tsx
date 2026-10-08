import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, measureElement, type DOMElement} from 'ink';
import type {Checkout} from '../checkouts.js';
import type {ClaudeState} from '../claudeState.js';
import type {Leap} from '../leap.js';
import {rowId, scrollStart, type ListView} from '../listModel.js';
import {highlight, type TitleMatches} from '../search.js';
import {STATUS_META, statusOf} from '../status.js';
import {ClaudeMarker} from './common.js';
import {TabBar, type Tab} from './TabBar.js';

type Props = {
	tabs: Tab[];
	tab: string | null;
	view: ListView;
	matches: TitleMatches;
	leap: Leap | null;
	checkouts: Map<string, Checkout>;
	/** The state of each PR's claude session, by PR url. */
	claude: Map<string, ClaudeState>;
	showArchived: boolean;
	/** Reports how many rows fit, for half-page motions. */
	onHeight: (rows: number) => void;
};

export function ListScreen({tabs, tab, view, matches, leap, checkouts, claude, showArchived, onHeight}: Props) {
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
	const start = scrollStart(view, height);
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
					const label = leap?.labels.get(row.pr.url);
					return (
						<Box key={key}>
							{label?.startsWith(leap!.typed) ? (
								<Box width={row.archived ? 6 : 4} flexShrink={0}>
									<Text bold>
										<Text color="gray">{leap!.typed}</Text>
										<Text color="black" backgroundColor="#d7ffaf">
											{label.slice(leap!.typed.length)}
										</Text>
									</Text>
								</Box>
							) : (
								<>
									<Text color="cyan">{isSel ? '❯ ' : '  '}</Text>
									{row.archived && (
										<Box width={2} flexShrink={0}>
											<Text color={meta.color} dimColor>
												{meta.icon}
											</Text>
										</Box>
									)}
									<Box width={2} flexShrink={0}>
										{claude.has(row.pr.url) ? (
											<ClaudeMarker state={claude.get(row.pr.url)!} />
										) : (
											<Text color="cyan" dimColor>
												{checkouts.has(row.pr.url) ? '⌂' : ' '}
											</Text>
										)}
									</Box>
								</>
							)}
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
