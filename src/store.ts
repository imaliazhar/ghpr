import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {PR} from './github.js';

/** A JSON file that loads `fallback` when missing or unreadable, and ignores write failures. */
export function jsonFile<T>(path: string, fallback: T) {
	return {
		load(): T {
			try {
				return JSON.parse(readFileSync(path, 'utf8')) as T;
			} catch {
				return fallback;
			}
		},
		save(value: T) {
			try {
				mkdirSync(dirname(path), {recursive: true});
				writeFileSync(path, JSON.stringify(value, null, 2));
			} catch {}
		},
	};
}

const CONFIG_DIR = join(homedir(), '.config', 'ghpr');
const CACHE_DIR = join(homedir(), '.cache', 'ghpr');

const archivedFile = jsonFile<string[]>(join(CONFIG_DIR, 'archived.json'), []);

export const archivedPrs = {
	load: () => new Set(archivedFile.load()),
	save: (urls: Set<string>) => archivedFile.save([...urls]),
};

const stateFile = jsonFile<{tab?: string | null}>(join(CONFIG_DIR, 'state.json'), {});

export const lastTab = {
	load: () => stateFile.load().tab ?? null,
	save: (tab: string | null) => stateFile.save({...stateFile.load(), tab}),
};

const CACHE_VERSION = 4;
const cacheFile = jsonFile<{version: number; savedAt: number; mine: PR[]} | null>(join(CACHE_DIR, 'prs.json'), null);

export const prCache = {
	load() {
		const data = cacheFile.load();
		return data?.version === CACHE_VERSION ? {savedAt: data.savedAt, mine: data.mine} : null;
	},
	save: (mine: PR[]) => cacheFile.save({version: CACHE_VERSION, savedAt: Date.now(), mine}),
};
