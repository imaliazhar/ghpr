import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {parseBotReview, shownItems} from '../src/botReview.js';

const body = `<!-- request-review:human-readable -->
## Implementation Strategy <sub><img alt="score" src="https://img.shields.io/static/v1?label=Score&message=3.6%2F5%20Good&color=c2410c" /></sub>

The structure fits, but the selection contract needs work.

| # | Strengths | Concerns |
| --- | --- | --- |
| 1 | Reuses tokens. | Sends events. |

## General Feedback

### 🟠 Important
- Selecting a web radio passes an event instead of its value.

## File-by-file Feedback
### 🟠 Important
- \`src/Radio.tsx:60-78\` [(Jump here)](https://example.com)
  
  Web selection sends the event instead of the radio value.
  \`\`\`tsx
  const handleChange = (...args) => {
    onChange(...args);
  };
  \`\`\`

### 🟡 Warnings
- \`src/Radio.native.tsx:38-43\` [(Jump here)](https://example.com)
  
  A numeric zero label is lost.
  - <details>
    <summary>[❗️Contested] - expand to read</summary>

    - \`Claude Reason\`: not this line.
    </details>

### 🟢 Wins
- \`src/Indicator.tsx:25-37\` [(Jump here)](https://example.com)
  
  Animation cleans up.

## Actions

### 🔴 Required | Selection contract
#### Pass the value to onChange

Call onChange with the radio value rather than the event.
- **Benefit:** Handlers get what the API promises.

### 🟡 Suggested | Native state coverage
#### Cover native loading behavior

Add a native Radio test for loading.

> ### Review outcome | 🔴 Requesting changes
`;

describe('parseBotReview', () => {
	const review = parseBotReview(body);

	test('reads the outcome and the strategy score and summary', () => {
		assert.equal(review.outcome, 'changes');
		assert.deepEqual(review.strategy, {score: '3.6/5 Good', summary: 'The structure fits, but the selection contract needs work.'});
	});

	test('reads file findings and required actions ordered by severity, skipping suggestions and contested notes', () => {
		assert.deepEqual(
			review.items.map(i => [i.severity, i.summary]),
			[
				['important', 'Web selection sends the event instead of the radio value.'],
				['required', 'Selection contract: Pass the value to onChange'],
				['warning', 'A numeric zero label is lost.'],
				['win', 'Animation cleans up.'],
			],
		);
	});

	test('shows only blocking findings until the bot approves, then warnings and wins too', () => {
		assert.deepEqual(shownItems(review).map(i => i.severity), ['important', 'required']);
		assert.deepEqual(shownItems({...review, outcome: 'approved'}).map(i => i.severity), ['important', 'required', 'warning', 'win']);
	});

	test('keeps locations, action details and dedented code', () => {
		const [file, required] = review.items;
		assert.equal(file.location, 'src/Radio.tsx:60-78');
		assert.deepEqual(file.code, ['const handleChange = (...args) => {', '  onChange(...args);', '};']);
		assert.equal(required.detail, 'Call onChange with the radio value rather than the event.');
	});

	test('falls back to general feedback without file findings', () => {
		const general = parseBotReview(body.replace(/## File-by-file Feedback[\s\S]*?## Actions/, '## Actions'));
		assert.equal(general.items[0].summary, 'Selecting a web radio passes an event instead of its value.');
	});

	test('a <details> block on one line, or left open, hides nothing after it', () => {
		const oneLine = parseBotReview(body.replace(/  - <details>[\s\S]*?<\/details>/, '  - <details><summary>Why</summary>text</details>'));
		assert.deepEqual(oneLine.items, review.items);
		const unclosed = parseBotReview(body.replace('    </details>\n', ''));
		assert.deepEqual(unclosed.items, review.items);
	});

	test('keeps a score with a stray % as written', () => {
		assert.equal(parseBotReview(body.replace('3.6%2F5%20Good', '80%')).strategy?.score, '80%');
	});
});
