import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

const FILE = join(homedir(), '.config', 'ghpr', 'archived.json');

export function loadArchived(): Set<string> {
	try {
		return new Set(JSON.parse(readFileSync(FILE, 'utf8')) as string[]);
	} catch {
		return new Set();
	}
}

export function saveArchived(urls: Set<string>) {
	mkdirSync(dirname(FILE), {recursive: true});
	writeFileSync(FILE, JSON.stringify([...urls], null, 2));
}
