import React, {useEffect, useState} from 'react';
import {Box, Text, useStdout} from 'ink';
import type {PR} from '../github.js';

function readableOn(hex: string) {
	const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'black' : 'white';
}

export function Labels({pr}: {pr: PR}) {
	return (
		<Box gap={1} flexWrap="wrap">
			{pr.labels.map(l => (
				<Text key={l.name} backgroundColor={`#${l.color}`} color={readableOn(l.color)}>
					{` ${l.name} `}
				</Text>
			))}
		</Box>
	);
}

export type KeyItem = {key: string; label: string; enabled?: boolean};

/** Key list drawn over its parent, which must fill the screen. Every cell is written so nothing shows through. */
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
					const disabled = i.enabled === false;
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

export function prActions(pr: PR | undefined, ready: boolean, canOpen: boolean): KeyItem[] {
	return [
		{key: 'w', label: 'open PR in browser', enabled: !!pr},
		{key: 'o', label: 'open tmux session for local checkout', enabled: canOpen},
		{key: 'm', label: 'queue via GitQueue', enabled: ready},
		{key: 't', label: 'toggle tunnel-review-vision', enabled: !!pr},
		{key: 'b', label: 'toggle in-review', enabled: !!pr},
		{key: 'a', label: 'archive / unarchive', enabled: !!pr},
	];
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
