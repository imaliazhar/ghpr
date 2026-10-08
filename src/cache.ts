import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {PR} from './github.js';

const FILE = join(homedir(), '.cache', 'ghpr', 'prs.json');
const VERSION = 1;

export type Cached = {savedAt: number; mine: PR[]};

export function loadCache(): Cached | null {
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return data.version === VERSION ? {savedAt: data.savedAt, mine: data.mine} : null;
	} catch {
		return null;
	}
}

export function saveCache(mine: PR[]) {
	try {
		mkdirSync(dirname(FILE), {recursive: true});
		writeFileSync(FILE, JSON.stringify({version: VERSION, savedAt: Date.now(), mine}));
	} catch {}
}
