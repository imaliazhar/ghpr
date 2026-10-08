import {homedir} from 'node:os';
import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {openUrl} from '../actions.js';
import {inTmuxPopup} from '../tmux.js';
import type {BotItem} from '../botReview.js';
import type {Checkout} from '../checkouts.js';
import type {PR} from '../github.js';
import {STATUS_META, TUNNEL_LABEL, hasLabel, statusOf} from '../status.js';
import {KeyHelp, Labels, prActions} from './common.js';

const SEVERITY: Record<BotItem['severity'], {label: string; color: string}> = {
	critical: {label: '🔴 critical', color: 'red'},
	important: {label: '🟠 important', color: 'yellow'},
	required: {label: '🔴 required', color: 'red'},
};

type Props = {
	pr: PR;
	canQueue: boolean;
	canOpen: boolean;
	checkout: Checkout | undefined;
	active: boolean;
	helpOpen: boolean;
	onBack: () => void;
	onRetry: () => void;
	onMissingLink: () => void;
};

export function DetailScreen({pr, canQueue, canOpen, checkout, active, helpOpen, onBack, onRetry, onMissingLink}: Props) {
	const failing = pr.requiredChecks.filter(c => c.state === 'failing');
	const running = pr.requiredChecks.filter(c => c.state === 'pending');
	const passed = pr.requiredChecks.filter(c => c.state === 'passed');
	const [cursor, setCursor] = useState(0);
	const selected = Math.min(cursor, failing.length - 1);

	useInput(
		(input, key) => {
			if (key.escape) onBack();
			if (key.ctrl) return;
			if (key.upArrow || input === 'k') setCursor(Math.max(0, selected - 1));
			if (key.downArrow || input === 'j') setCursor(Math.min(failing.length - 1, selected + 1));
			if (input === 'g') setCursor(0);
			if (input === 'G') setCursor(Math.max(0, failing.length - 1));
			if (key.return && failing[selected]) {
				const url = failing[selected].url;
				if (url) openUrl(url);
				else onMissingLink();
			}
			if (input === 'r' && failing.length) onRetry();
		},
		{isActive: active},
	);

	const status = statusOf(pr);
	const meta = STATUS_META[status];
	const approvedBy = pr.reviews.filter(r => r.state === 'APPROVED').map(r => r.author);
	const changesBy = pr.reviews.filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.author);

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				<Text>
					<Text color={meta.color} bold>
						{meta.icon} {meta.label}
					</Text>
					<Text dimColor>
						{'  '}
						{pr.repo}#{pr.number}{' '}
					</Text>
				</Text>
				<Text bold>{pr.title}</Text>
				<Box gap={2}>
					<Text dimColor>{pr.headRef}</Text>
					<Labels pr={pr} />
				</Box>
				{checkout && (
					<Text color="cyan" dimColor>
						⌂ {checkout.dir.replace(homedir(), '~')}
					</Text>
				)}

				{hasLabel(pr, TUNNEL_LABEL) && (
					<Box marginTop={1}>
						<Text color="yellow">⏸ checks paused ({TUNNEL_LABEL})</Text>
					</Box>
				)}

				{pr.bot?.outcome === 'changes' && (
					<Box marginTop={1} borderStyle="round" borderColor="red" flexDirection="column" paddingX={1}>
						<Text color="red" bold>
							Review bot: requesting changes
						</Text>
						{pr.bot.parsed ? (
							pr.bot.items.map((item, i) => (
								<Box key={i}>
									<Box width={14} flexShrink={0}>
										<Text color={SEVERITY[item.severity].color}>{SEVERITY[item.severity].label}</Text>
									</Box>
									<Box flexDirection="column" flexGrow={1} flexShrink={1}>
										<Text>{item.summary}</Text>
										{item.location && <Text dimColor>{item.location}</Text>}
									</Box>
								</Box>
							))
						) : (
							<Text dimColor>details unavailable</Text>
						)}
					</Box>
				)}
				{pr.bot?.outcome === 'approved' && (
					<Box marginTop={1}>
						<Text color="green">Review bot: ✔ approved</Text>
					</Box>
				)}
				{pr.bot?.outcome === 'unknown' && (
					<Box marginTop={1}>
						<Text color="gray">Review bot: reviewing…</Text>
					</Box>
				)}

				<Box marginTop={1} flexDirection="column">
					<Text bold>Required checks</Text>
					{pr.requiredChecks.length === 0 && <Text dimColor>  none reported</Text>}
					{failing.map((c, i) => (
						<Text key={c.name}>
							<Text color="cyan">{i === selected ? '❯ ' : '  '}</Text>
							<Text color="red" bold={i === selected}>
								✗ {c.name}
							</Text>
							{!c.url && <Text dimColor> (no link)</Text>}
						</Text>
					))}
					{running.length > 0 && (
						<Text>
							<Text color="yellow">  ● {running.length} running </Text>
							<Text dimColor>{running.map(c => c.name).join(', ')}</Text>
						</Text>
					)}
					{passed.length > 0 && (
						<Text wrap="truncate">
							<Text color="green">  ✔ {passed.length} passed </Text>
							<Text dimColor>{passed.map(c => c.name).join(', ')}</Text>
						</Text>
					)}
					{pr.optionalCheckCount > 0 && <Text dimColor>  +{pr.optionalCheckCount} optional checks</Text>}
				</Box>

				<Box marginTop={1} flexDirection="column">
					<Text bold>Reviews</Text>
					{approvedBy.length > 0 && <Text color="green">  ✔ approved: {approvedBy.join(', ')}</Text>}
					{changesBy.length > 0 && <Text color="red">  ✗ changes requested: {changesBy.join(', ')}</Text>}
					{pr.waitingOn.length > 0 && <Text color="magenta">  ◌ waiting on: {pr.waitingOn.join(', ')}</Text>}
					{approvedBy.length + changesBy.length + pr.waitingOn.length === 0 && <Text dimColor>  no reviews yet</Text>}
				</Box>

			</Box>
			{helpOpen && (
				<KeyHelp
					items={[
						...(failing.length
							? [
									{key: '↑/↓ j/k', label: 'select failing check'},
									{key: 'enter', label: 'open check in browser'},
									{key: 'r', label: 'retry check', enabled: false},
								]
							: []),
						...prActions(pr, canQueue, canOpen),
						{key: 'esc', label: 'back to list'},
						{key: 'R', label: 'refresh'},
						{key: 'q', label: inTmuxPopup ? 'hide popup' : 'quit'},
					]}
				/>
			)}
		</Box>
	);
}
