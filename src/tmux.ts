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

const tmux = async (args: string[]) => (await run('tmux', args)).stdout;

/** The most recently active client outside the popup session, which the popup was opened from. */
async function outerClient() {
	const clients = (await tmux(['list-clients', '-F', '#{client_activity} #{session_name} #{client_name}']))
		.trim()
		.split('\n')
		.map(line => line.split(' '))
		.filter(([, session]) => session !== popupSession)
		.sort(([a], [b]) => Number(b) - Number(a));
	return clients[0]?.[2];
}

/**
 * Switches to the tmux session for `dir`, creating it with $EDITOR open if it doesn't exist.
 * From the popup, it switches the client the popup was opened from and hides the popup.
 */
export async function openSession(dir: string) {
	const name = sessionName(dir);
	const exists = await tmux(['has-session', '-t', `=${name}`]).then(() => true, () => false);
	if (!exists) {
		const editor = process.env.EDITOR;
		await tmux(['new-session', '-d', '-s', name, '-c', dir, ...(editor ? ['-n', editor] : [])]);
		if (editor) await tmux(['send-keys', '-t', `=${name}:`, editor, 'Enter']);
	}
	if (!inTmuxPopup) return void (await tmux(['switch-client', '-t', `=${name}`]));
	const client = await outerClient();
	if (!client) throw new Error('No tmux client to switch');
	await tmux(['switch-client', '-c', client, '-t', `=${name}`]);
	hideTmuxPopup(() => {});
}
