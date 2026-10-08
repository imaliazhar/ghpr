import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openSession, sessionName, type TmuxEnv} from '../src/tmux.js';

/** A tmux that records commands; `sessions` exist with `windows`, `clients` are `activity session name` lines. */
function fakeTmux(options: Partial<Omit<TmuxEnv, 'run'> & {sessions: string[]; windows: string; clients: string}> = {}) {
	const {sessions, windows, clients, popupSession, editor} = {sessions: [] as string[], windows: '1\n2\n', clients: '', popupSession: undefined, editor: 'nvim', ...options};
	const calls: string[] = [];
	const env: TmuxEnv = {
		popupSession,
		editor,
		run: async args => {
			calls.push(args.join(' '));
			if (args[0] === 'has-session' && !sessions.includes(args[2].slice(1))) throw new Error('no session');
			return args[0] === 'list-clients' ? clients : args[0] === 'list-windows' ? windows : '';
		},
	};
	return {env, calls};
}

test('names sessions after the folder with dots replaced', () => {
	assert.equal(sessionName('/p/anchor.nvim'), 'anchor_nvim');
});

test('creates a missing session with the editor and claude, focused on claude', async () => {
	const {env, calls} = fakeTmux();
	await openSession('/p/app', env);
	assert.deepEqual(calls, [
		'has-session -t =app',
		'new-session -d -s app -c /p/app -n nvim',
		'send-keys -t =app:1 nvim Enter',
		'new-window -d -t =app:2 -n claude -c /p/app',
		'send-keys -t =app:2 claude Enter',
		'list-windows -t =app -F #{window_index}',
		'select-window -t =app:2',
		'switch-client -t =app',
	]);
});

test('skips the editor when none is set', async () => {
	const {env, calls} = fakeTmux({editor: undefined});
	await openSession('/p/app', env);
	assert.equal(calls[1], 'new-session -d -s app -c /p/app');
	assert.ok(!calls.some(c => c.startsWith('send-keys -t =app:1')));
});

test('reuses an existing session and focuses window 2 when it has one', async () => {
	const {env, calls} = fakeTmux({sessions: ['app']});
	await openSession('/p/app', env);
	assert.deepEqual(calls, ['has-session -t =app', 'list-windows -t =app -F #{window_index}', 'select-window -t =app:2', 'switch-client -t =app']);
});

test('leaves the focused window alone when the session has no window 2', async () => {
	const {env, calls} = fakeTmux({sessions: ['app'], windows: '1\n'});
	await openSession('/p/app', env);
	assert.ok(!calls.some(c => c.startsWith('select-window')));
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
