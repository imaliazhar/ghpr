import React from 'react';
import {Box, Text} from 'ink';
import type {PR} from '../github.js';
import {useTerminalSize} from './common.js';

export type Tab = {repo: string | null; label: string; count: number};

export function buildTabs(prs: PR[], archived: Set<string>): Tab[] {
	const byRepo = new Map<string, PR[]>();
	for (const pr of prs) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr]);
	const activeCount = (group: PR[]) => group.filter(p => !archived.has(p.url)).length;
	const name = (repo: string) => repo.split('/')[1];
	const repos = [...byRepo.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

	return [
		{repo: null, label: 'All', count: activeCount(prs)},
		...repos.map(([repo, group]) => ({
			repo,
			label: repos.filter(([other]) => name(other) === name(repo)).length > 1 ? repo : name(repo),
			count: activeCount(group),
		})),
	];
}

const SEPARATOR = ' │ ';
const MORE_LEFT = '‹ ';
const MORE_RIGHT = ' ›';

const tabText = (t: Tab) => ` ${t.label} ${t.count} `;

function visibleRange(tabs: Tab[], activeIndex: number, width: number) {
	const fits = (start: number, end: number) => {
		const tabsWidth = tabs.slice(start, end).reduce((sum, t) => sum + tabText(t).length, 0);
		const separators = SEPARATOR.length * (end - start - 1);
		const arrows = (start > 0 ? MORE_LEFT.length : 0) + (end < tabs.length ? MORE_RIGHT.length : 0);
		return tabsWidth + separators + arrows <= width;
	};

	let start = 0;
	while (start < activeIndex && !fits(start, activeIndex + 1)) start++;
	let end = activeIndex + 1;
	while (end < tabs.length && fits(start, end + 1)) end++;
	return {start, end};
}

export function TabBar({tabs, active}: {tabs: Tab[]; active: string | null}) {
	const {columns} = useTerminalSize();
	const activeIndex = Math.max(0, tabs.findIndex(t => t.repo === active));
	const {start, end} = visibleRange(tabs, activeIndex, columns - 4);

	return (
		<Box borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0}>
			<Text wrap="truncate">
				{start > 0 && <Text color="cyan">{MORE_LEFT}</Text>}
				{tabs.slice(start, end).map((t, i) => (
					<Text key={t.repo ?? 'all'}>
						{i > 0 && <Text color="gray">{SEPARATOR}</Text>}
						{t.repo === active ? (
							<Text color="cyan" bold inverse>
								{tabText(t)}
							</Text>
						) : (
							<Text dimColor>{tabText(t)}</Text>
						)}
					</Text>
				))}
				{end < tabs.length && <Text color="cyan">{MORE_RIGHT}</Text>}
			</Text>
		</Box>
	);
}
