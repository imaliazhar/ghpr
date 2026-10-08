import {homedir} from 'node:os';
import React, {useEffect, useRef, useState} from 'react';
import {Box, Text, measureElement, type DOMElement} from 'ink';
import type {BotItem} from '../botReview.js';
import type {Checkout} from '../checkouts.js';
import type {Check, PR} from '../github.js';
import {STATUS_META, TUNNEL_LABEL, failingChecks, hasLabel, statusOf} from '../status.js';
import {Labels, useTerminalSize} from './common.js';

const SEVERITY: Record<BotItem['severity'], {label: string; color: string}> = {
	critical: {label: '🔴 critical', color: 'red'},
	important: {label: '🟠 important', color: 'yellow'},
	required: {label: '🔴 required', color: 'red'},
};

/** Below this width the panels stack instead of sitting side by side. */
const TWO_COLUMN_MIN = 110;

type Props = {
	pr: PR;
	checkout: Checkout | undefined;
	selectedCheck: number;
};

function Panel({title, color = 'gray', grow, children}: {title: React.ReactNode; color?: string; grow?: boolean; children: React.ReactNode}) {
	return (
		<Box
			borderStyle="round"
			borderColor={color}
			flexDirection="column"
			paddingX={1}
			flexGrow={grow ? 1 : 0}
			flexShrink={grow ? 1 : 0}
			overflow="hidden"
		>
			<Box marginBottom={1} flexShrink={0}>
				<Text bold wrap="truncate">
					{title}
				</Text>
			</Box>
			{children}
		</Box>
	);
}

/** Narrowest column the check grid truncates names to. */
const MIN_CHECK_COLUMN = 30;
const COLUMN_GAP = 2;

/**
 * Check names in columns across `width`: as few columns as fit within `maxRows` rows, so names are only
 * truncated when the list wouldn't otherwise fit.
 */
function CheckGrid({checks, icon, color, width, maxRows}: {checks: Check[]; icon: string; color: string; width: number; maxRows: number}) {
	const natural = Math.max(...checks.map(c => c.name.length)) + 2 + COLUMN_GAP;
	const fitting = Math.max(1, Math.floor(width / natural));
	const most = Math.max(fitting, Math.floor(width / MIN_CHECK_COLUMN));
	const needed = Math.ceil(checks.length / Math.max(1, maxRows));
	const columns = Math.min(checks.length, Math.max(fitting, Math.min(most, needed)));
	const cell = Math.floor(width / columns);
	return (
		<Box flexWrap="wrap" flexShrink={0}>
			{checks.map(c => (
				<Box key={c.name} width={cell} paddingRight={COLUMN_GAP} flexShrink={0}>
					<Text wrap="truncate">
						<Text color={color}>{icon} </Text>
						<Text dimColor>{c.name}</Text>
					</Text>
				</Box>
			))}
		</Box>
	);
}

/** `width` is the panel's inner width, inside its border and padding. */
function ChecksPanel({pr, selectedCheck, width}: {pr: PR; selectedCheck: number; width: number}) {
	const ref = useRef<DOMElement>(null);
	const [outerHeight, setOuterHeight] = useState(0);
	useEffect(() => {
		const measured = ref.current ? measureElement(ref.current).height : 0;
		if (measured !== outerHeight) setOuterHeight(measured);
	});
	const height = outerHeight - 2;
	const failing = failingChecks(pr);
	const running = pr.requiredChecks.filter(c => c.state === 'pending');
	const passed = pr.requiredChecks.filter(c => c.state === 'passed');
	const selected = Math.min(selectedCheck, failing.length - 1);
	const counts = [
		failing.length > 0 && <Text key="f" color="red">{failing.length} failing</Text>,
		running.length > 0 && <Text key="r" color="yellow">{running.length} running</Text>,
		passed.length > 0 && <Text key="p" color="green">{passed.length} passed</Text>,
		pr.optionalCheckCount > 0 && <Text key="o" dimColor>+{pr.optionalCheckCount} optional</Text>,
	].filter(Boolean);
	const paused = hasLabel(pr, TUNNEL_LABEL);
	const runningRows = running.length ? Math.ceil(running.length / Math.max(1, Math.floor(width / MIN_CHECK_COLUMN))) + 1 : 0;
	const passedRows = height - 2 - (paused ? 2 : 0) - (failing.length ? failing.length + 1 : 0) - runningRows;

	return (
		<Box ref={ref} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
			<Panel
				grow
				title={
					<>
						Required checks
						{counts.map((count, i) => (
							<Text key={i} bold={false}>
								{i === 0 ? '  ' : ' · '}
								{count}
							</Text>
						))}
					</>
				}
			>
				{paused && (
					<Box marginBottom={1}>
						<Text color="yellow">⏸ paused while {TUNNEL_LABEL} is on</Text>
					</Box>
				)}
				{pr.requiredChecks.length === 0 && <Text dimColor>none reported</Text>}
				{failing.map((c, i) => (
					<Text key={c.name} wrap="truncate">
						<Text color="cyan">{i === selected ? '❯ ' : '  '}</Text>
						<Text color="red" bold={i === selected}>
							✗ {c.name}
						</Text>
						{!c.url && <Text dimColor> (no link)</Text>}
					</Text>
				))}
				{running.length > 0 && (
					<Box marginTop={failing.length ? 1 : 0}>
						<CheckGrid checks={running} icon="●" color="yellow" width={width} maxRows={running.length} />
					</Box>
				)}
				{passed.length > 0 && (
					<Box marginTop={failing.length + running.length ? 1 : 0}>
						<CheckGrid checks={passed} icon="✔" color="green" width={width} maxRows={passedRows} />
					</Box>
				)}
			</Panel>
		</Box>
	);
}

function BotPanel({pr}: {pr: PR}) {
	const bot = pr.bot;
	if (!bot) return null;
	if (bot.outcome === 'approved') {
		return (
			<Panel title={<Text color="green">Review bot</Text>} color="green">
				<Text color="green">✔ approved</Text>
			</Panel>
		);
	}
	if (bot.outcome === 'unknown') {
		return (
			<Panel title="Review bot">
				<Text dimColor>reviewing…</Text>
			</Panel>
		);
	}
	return (
		<Panel title={<Text color="red">Review bot: requesting changes</Text>} color="red">
			{bot.parsed ? (
				bot.items.map((item, i) => (
					<Box key={i} flexDirection="column" marginTop={i ? 1 : 0}>
						<Text color={SEVERITY[item.severity].color}>{SEVERITY[item.severity].label}</Text>
						<Text>{item.summary}</Text>
						{item.location && <Text dimColor>{item.location}</Text>}
					</Box>
				))
			) : (
				<Text dimColor>details unavailable</Text>
			)}
		</Panel>
	);
}

function ReviewsPanel({pr}: {pr: PR}) {
	const approvedBy = pr.reviews.filter(r => r.state === 'APPROVED').map(r => r.author);
	const changesBy = pr.reviews.filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.author);
	return (
		<Panel title="Reviews">
			{approvedBy.map(name => (
				<Text key={name} color="green">
					✔ {name}
				</Text>
			))}
			{changesBy.map(name => (
				<Text key={name} color="red">
					✗ {name} <Text dimColor>requested changes</Text>
				</Text>
			))}
			{pr.waitingOn.map(name => (
				<Text key={name} color="magenta">
					◌ {name} <Text dimColor>waiting</Text>
				</Text>
			))}
			{approvedBy.length + changesBy.length + pr.waitingOn.length === 0 && <Text dimColor>no reviews yet</Text>}
		</Panel>
	);
}

export function DetailScreen({pr, checkout, selectedCheck}: Props) {
	const {columns} = useTerminalSize();
	const meta = STATUS_META[statusOf(pr)];
	const twoColumns = columns >= TWO_COLUMN_MIN;
	const sideWidth = Math.floor(columns * 0.4);
	const checksWidth = (twoColumns ? columns - sideWidth - 1 : columns) - 4;

	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			<Box borderStyle="round" borderColor={meta.color} flexDirection="column" paddingX={1} flexShrink={0}>
				<Box justifyContent="space-between">
					<Text color={meta.color} bold>
						{meta.icon} {meta.label}
					</Text>
					<Text dimColor>
						{pr.repo}#{pr.number}
					</Text>
				</Box>
				<Text bold>{pr.title}</Text>
				<Box gap={3}>
					<Text dimColor wrap="truncate">
						⎇ {pr.headRef}
					</Text>
					{checkout && (
						<Text color="cyan" dimColor wrap="truncate">
							⌂ {checkout.dir.replace(homedir(), '~')}
						</Text>
					)}
					{twoColumns && <Labels pr={pr} />}
				</Box>
				{!twoColumns && pr.labels.length > 0 && <Labels pr={pr} />}
			</Box>

			<Box flexDirection={twoColumns ? 'row' : 'column'} flexGrow={1} gap={twoColumns ? 1 : 0} overflow="hidden">
				<ChecksPanel pr={pr} selectedCheck={selectedCheck} width={checksWidth} />
				<Box flexDirection="column" width={twoColumns ? sideWidth : undefined} flexShrink={0}>
					<BotPanel pr={pr} />
					<ReviewsPanel pr={pr} />
				</Box>
			</Box>
		</Box>
	);
}
