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

const popupSession = process.env.TMUX_PANE ? process.env.GHPR_POPUP : undefined;

export const inTmuxPopup = !!popupSession;

/** Detaches the clients of the popup's dedicated session, named by GHPR_POPUP. */
export function hideTmuxPopup(onFailure: () => void) {
	execFile('tmux', ['detach-client', '-s', `=${popupSession}`], error => error && onFailure());
}
