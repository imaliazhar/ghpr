import {execFile} from 'node:child_process';
import {basename} from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);

export const inTmux = !!process.env.TMUX;

const popupSession = process.env.TMUX_PANE ? process.env.GHPR_POPUP : undefined;

export const inTmuxPopup = !!popupSession;

/** Detaches the clients of the popup's dedicated session, named by GHPR_POPUP. */
export function hideTmuxPopup(onFailure: () => void) {
	execFile('tmux', ['detach-client', '-s', `=${popupSession}`], error => error && onFailure());
}

export const sessionName = (dir: string) => basename(dir).replaceAll('.', '_');

/** What `openSession` needs from tmux and the environment. */
export type TmuxEnv = {
	run: (args: string[]) => Promise<string>;
	popupSession: string | undefined;
	editor: string | undefined;
};

const defaultEnv: TmuxEnv = {
	run: async args => (await run('tmux', args)).stdout,
	popupSession,
	editor: process.env.EDITOR,
};

/** The most recently active client outside the popup session, which the popup was opened from. */
async function outerClient(env: TmuxEnv) {
	const clients = (await env.run(['list-clients', '-F', '#{client_activity} #{session_name} #{client_name}']))
		.trim()
		.split('\n')
		.map(line => line.split(' '))
		.filter(([, session]) => session !== env.popupSession)
		.sort(([a], [b]) => Number(b) - Number(a));
	return clients[0]?.[2];
}

/**
 * Switches to the tmux session for `dir`, focused on window 2 (claude) when it has one. A new session
 * gets the editor in window 1 and claude in window 2, both in `dir`.
 * From the popup, it switches the client the popup was opened from and hides the popup.
 */
export async function openSession(dir: string, env: TmuxEnv = defaultEnv) {
	const name = sessionName(dir);
	const exists = await env.run(['has-session', '-t', `=${name}`]).then(() => true, () => false);
	if (!exists) {
		await env.run(['new-session', '-d', '-s', name, '-c', dir, ...(env.editor ? ['-n', env.editor] : [])]);
		if (env.editor) await env.run(['send-keys', '-t', `=${name}:1`, env.editor, 'Enter']);
		await env.run(['new-window', '-d', '-t', `=${name}:2`, '-n', 'claude', '-c', dir]);
		await env.run(['send-keys', '-t', `=${name}:2`, 'claude', 'Enter']);
	}
	const windows = await env.run(['list-windows', '-t', `=${name}`, '-F', '#{window_index}']);
	if (windows.split('\n').includes('2')) await env.run(['select-window', '-t', `=${name}:2`]);
	if (!env.popupSession) return void (await env.run(['switch-client', '-t', `=${name}`]));
	const client = await outerClient(env);
	if (!client) throw new Error('No tmux client to switch');
	await env.run(['switch-client', '-c', client, '-t', `=${name}`]);
	await env.run(['detach-client', '-s', `=${env.popupSession}`]).catch(() => {});
}
