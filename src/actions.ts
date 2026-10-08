import {execFile} from 'node:child_process';
import {gh, type PR} from './github.js';

export function openUrl(url: string) {
	execFile('open', [url]);
}

export async function queueForMerge(pr: PR) {
	await gh(['pr', 'comment', String(pr.number), '-R', pr.repo, '--body', '/gitqueue add normal']);
}

export async function setLabel(pr: PR, label: string, on: boolean) {
	await gh(['pr', 'edit', String(pr.number), '-R', pr.repo, on ? '--add-label' : '--remove-label', label]);
}
