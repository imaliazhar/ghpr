import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openSession, sessionName, type TmuxEnv} from '../src/tmux.js';

/** A tmux that records commands; `sessions` exist, `clients` are `activity session name` lines. */
function fakeTmux(options: Partial<Omit<TmuxEnv, 'run'> & {sessions: string[]; clients: string}> = {}) {
	const {sessions, clients, popupSession, editor} = {sessions: [] as string[], clients: '', popupSession: undefined, editor: 'nvim', ...options};
	const calls: string[] = [];
	const env: TmuxEnv = {
		popupSession,
		editor,
		run: async args => {
			calls.push(args.join(' '));
			if (args[0] === 'has-session' && !sessions.includes(args[2].slice(1))) throw new Error('no session');
			return args[0] === 'list-clients' ? clients : '';
		},
	};
	return {env, calls};
}

test('names sessions after the folder with dots replaced', () => {
	assert.equal(sessionName('/p/anchor.nvim'), 'anchor_nvim');
});

test('creates a missing session with the editor open, then switches to it', async () => {
	const {env, calls} = fakeTmux();
	await openSession('/p/app', env);
	assert.deepEqual(calls, [
		'has-session -t =app',
		'new-session -d -s app -c /p/app -n nvim',
		'send-keys -t =app: nvim Enter',
		'switch-client -t =app',
	]);
});

test('skips the editor when none is set', async () => {
	const {env, calls} = fakeTmux({editor: undefined});
	await openSession('/p/app', env);
	assert.deepEqual(calls.slice(1, 2), ['new-session -d -s app -c /p/app']);
	assert.equal(calls.length, 3);
});

test('reuses an existing session', async () => {
	const {env, calls} = fakeTmux({sessions: ['app']});
	await openSession('/p/app', env);
	assert.deepEqual(calls, ['has-session -t =app', 'switch-client -t =app']);
});

test('from the popup, switches the most recent outer client and hides the popup', async () => {
	const clients = ['100 main /dev/ttys001', '300 _ghpr /dev/ttys003', '200 work /dev/ttys002'].join('\n');
	const {env, calls} = fakeTmux({sessions: ['app'], clients, popupSession: '_ghpr'});
	await openSession('/p/app', env);
	assert.deepEqual(calls.slice(-2), ['switch-client -c /dev/ttys002 -t =app', 'detach-client -s =_ghpr']);
});

test('fails when the popup has no outer client to switch', async () => {
	const {env} = fakeTmux({sessions: ['app'], clients: '300 _ghpr /dev/ttys003', popupSession: '_ghpr'});
	await assert.rejects(openSession('/p/app', env), /No tmux client/);
});
