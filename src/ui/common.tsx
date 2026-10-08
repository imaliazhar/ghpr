import React, {useEffect, useState} from 'react';
import {Box, Text, useStdout} from 'ink';
import {readClaudeStates, type ClaudeState} from '../claudeState.js';
import type {PR} from '../github.js';
import type {KeyItem} from '../keymap.js';

/** Lifts dark label colours towards white so they stay visible on a dark terminal. */
function visibleOnDark(hex: string) {
	const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
	const [r, g, b] = rgb;
	const lift = Math.max(0, 0.6 - (0.299 * r + 0.587 * g + 0.114 * b) / 255);
	return '#' + rgb.map(c => Math.round(c + (255 - c) * lift).toString(16).padStart(2, '0')).join('');
}

export function Labels({pr}: {pr: PR}) {
	return (
		<Box gap={2} flexWrap="wrap">
			{pr.labels.map(l => (
				<Text key={l.name}>
					<Text color={visibleOnDark(l.color)}>●</Text>
					<Text dimColor> {l.name}</Text>
				</Text>
			))}
		</Box>
	);
}

export function KeyHelp({items}: {items: KeyItem[]}) {
	const footer = 'esc close';
	const keyWidth = Math.max(...items.map(i => i.key.length));
	const width = Math.max(footer.length, ...items.map(i => keyWidth + 2 + i.label.length));
	const line = (text: string) => ` ${text.padEnd(width)} `;
	return (
		<Box position="absolute" width="100%" height="100%" justifyContent="center" alignItems="center">
			<Box borderStyle="round" borderColor="cyan" flexDirection="column">
				<Text bold>{line('Keys')}</Text>
				<Text>{line('')}</Text>
				{items.map(i => {
					const disabled = !i.enabled;
					return (
						<Text key={i.key}>
							{' '}
							<Text color={disabled ? undefined : 'cyan'} dimColor={disabled} strikethrough={disabled}>
								{i.key.padEnd(keyWidth)}
							</Text>
							{'  '}
							<Text dimColor={disabled} strikethrough={disabled}>
								{i.label}
							</Text>
							{' '.repeat(width - keyWidth - 2 - i.label.length + 1)}
						</Text>
					);
				})}
				<Text>{line('')}</Text>
				<Text dimColor>{line(footer)}</Text>
			</Box>
		</Box>
	);
}

export function useTerminalSize() {
	const {stdout} = useStdout();
	const read = () => ({columns: stdout.columns || 100, rows: stdout.rows || 30});
	const [size, setSize] = useState(read);
	useEffect(() => {
		const onResize = () => setSize(read());
		stdout.on('resize', onResize);
		return () => {
			stdout.off('resize', onResize);
		};
	}, [stdout]);
	return size;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner() {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
		return () => clearInterval(id);
	}, []);
	return <Text>{SPINNER_FRAMES[frame]}</Text>;
}

export const CLAUDE_STATE_LABEL: Record<ClaudeState, string> = {
	working: 'claude working',
	waiting: 'claude waiting for you',
	permission: 'claude needs permission',
};

/** One cell showing what the PR's claude session is doing. */
export function ClaudeMarker({state}: {state: ClaudeState}) {
	if (state === 'working')
		return (
			<Text color="yellow">
				<Spinner />
			</Text>
		);
	return state === 'waiting' ? <Text color="magenta">●</Text> : <Text color="red" bold>!</Text>;
}

/** Claude Code session states by project folder, reread every `intervalMs`. */
export function useClaudeStates(intervalMs = 2000) {
	const [states, setStates] = useState(new Map<string, ClaudeState>());
	useEffect(() => {
		let last = '';
		const read = () =>
			readClaudeStates().then(next => {
				const key = JSON.stringify([...next]);
				if (key !== last) {
					last = key;
					setStates(next);
				}
			});
		read();
		const id = setInterval(read, intervalMs);
		return () => clearInterval(id);
	}, [intervalMs]);
	return states;
}
