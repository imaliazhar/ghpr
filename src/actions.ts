import {execFile} from 'node:child_process';
import {gh, type PR} from './github.js';

const inFlight = new Set<Promise<unknown>>();

function track<T>(promise: Promise<T>) {
	inFlight.add(promise);
	promise.then(
		() => inFlight.delete(promise),
		() => inFlight.delete(promise),
	);
	return promise;
}

export const settleActions = () => Promise.allSettled([...inFlight]);
export const pendingActionCount = () => inFlight.size;

export function openUrl(url: string) {
	execFile('open', [url]);
}

export async function queueForMerge(pr: PR) {
	await track(gh(['pr', 'comment', String(pr.number), '-R', pr.repo, '--body', '/gitqueue add normal']));
}

export async function setLabel(pr: PR, label: string, on: boolean) {
	await track(gh(['pr', 'edit', String(pr.number), '-R', pr.repo, on ? '--add-label' : '--remove-label', label]));
}
