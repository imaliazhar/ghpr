import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

const FILE = join(homedir(), '.config', 'ghpr', 'state.json');

type State = {tab: string | null};

function load(): State {
	try {
		return {tab: null, ...JSON.parse(readFileSync(FILE, 'utf8'))};
	} catch {
		return {tab: null};
	}
}

export const loadLastTab = () => load().tab;

export function saveLastTab(tab: string | null) {
	try {
		mkdirSync(dirname(FILE), {recursive: true});
		writeFileSync(FILE, JSON.stringify({...load(), tab}, null, 2));
	} catch {}
}
