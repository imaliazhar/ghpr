import React from 'react';
import {render} from 'ink';
import {pendingActionCount, settleActions} from './actions.js';
import {App} from './ui/App.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[H';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';

process.stdout.write(ENTER_ALT_SCREEN);
let restored = false;
const restore = () => {
	if (restored) return;
	restored = true;
	process.stdout.write(LEAVE_ALT_SCREEN);
};
process.on('exit', restore);

const instance = render(<App all={process.argv.includes('--all')} />);
instance.waitUntilExit().then(
	async () => {
		restore();
		if (pendingActionCount()) console.error(`Waiting for ${pendingActionCount()} GitHub action(s) to finish…`);
		const failed = (await settleActions()).filter(r => r.status === 'rejected');
		for (const r of failed) console.error(`ghpr: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
		process.exit(failed.length ? 1 : 0);
	},
	error => {
		restore();
		console.error(error);
		process.exit(1);
	},
);
