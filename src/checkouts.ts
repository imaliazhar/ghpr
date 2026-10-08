import {access, readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {currentBranch, isBranchOf, type Branch} from './git.js';
import type {PR} from './github.js';

export const PROJECTS_DIR = join(homedir(), 'Projects');

export type Checkout = Branch & {dir: string};

const CONCURRENCY = 8;

/** Reads the branch and origin of every git checkout directly under `root`. Never rejects. */
export async function scanCheckouts(root = PROJECTS_DIR): Promise<Checkout[]> {
	const entries = await readdir(root, {withFileTypes: true}).catch(() => []);
	const dirs = entries.filter(e => e.isDirectory()).map(e => join(root, e.name));
	const found: Checkout[] = [];
	let next = 0;
	const worker = async () => {
		while (next < dirs.length) {
			const dir = dirs[next++];
			const isRepo = await access(join(dir, '.git')).then(() => true, () => false);
			const branch = isRepo ? await currentBranch(dir) : null;
			if (branch) found.push({...branch, dir});
		}
	};
	await Promise.all(Array.from({length: CONCURRENCY}, worker));
	return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Maps each PR url to the first checkout on its branch. */
export function checkoutsByPr(prs: PR[], checkouts: Checkout[]): Map<string, Checkout> {
	return new Map(
		prs.flatMap(pr => {
			const checkout = checkouts.find(c => isBranchOf(pr, c));
			return checkout ? [[pr.url, checkout] as const] : [];
		}),
	);
}
