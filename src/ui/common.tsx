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

export function Tags({pr}: {pr: PR}) {
	return (
		<>
			{pr.isDraft && <Text color="gray">[draft] </Text>}
			{pr.hasConflicts && <Text color="red">[conflicts] </Text>}
		</>
	);
}

export type FooterItem = {key: string; label: string; enabled?: boolean};

export function Footer({items}: {items: FooterItem[]}) {
	return (
		<Box marginTop={1} flexWrap="wrap" columnGap={2} flexShrink={0}>
			{items.map(i => (
				<Text key={i.key} dimColor={i.enabled === false} strikethrough={i.enabled === false}>
					<Text color={i.enabled === false ? undefined : 'cyan'}>{i.key}</Text> {i.label}
				</Text>
			))}
		</Box>
	);
}

export function prActions(pr: PR | undefined, ready: boolean, canOpen: boolean): FooterItem[] {
	return [
		{key: 'w', label: 'open PR', enabled: !!pr},
		{key: 'o', label: 'session', enabled: canOpen},
		{key: 'm', label: 'queue', enabled: ready},
		{key: 't', label: 'tunnel', enabled: !!pr},
		{key: 'b', label: 'in-review', enabled: !!pr},
		{key: 'a', label: 'archive', enabled: !!pr},
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
