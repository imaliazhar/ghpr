import React from 'react';
import {render} from 'ink';
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
instance.waitUntilExit().finally(restore);
