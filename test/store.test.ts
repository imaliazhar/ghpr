import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {jsonFile} from '../src/store.js';

const dir = mkdtempSync(join(tmpdir(), 'ghpr-store-'));

test('round-trips a value, creating missing directories', () => {
	const file = jsonFile(join(dir, 'nested', 'a.json'), {count: 0});
	file.save({count: 3});
	assert.deepEqual(file.load(), {count: 3});
});

test('loads the fallback when the file is missing or corrupt', () => {
	assert.deepEqual(jsonFile(join(dir, 'missing.json'), []).load(), []);
	writeFileSync(join(dir, 'corrupt.json'), '{not json');
	assert.equal(jsonFile(join(dir, 'corrupt.json'), null).load(), null);
});

test('ignores write failures', () => {
	writeFileSync(join(dir, 'a-file'), '');
	assert.doesNotThrow(() => jsonFile(join(dir, 'a-file', 'b.json'), 0).save(1));
});
