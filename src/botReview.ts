export const BOT_MARKER = '<!-- request-review:human-readable -->';

export type BotItem = {
	severity: 'critical' | 'important' | 'required';
	summary: string;
	location: string | null;
};

export type BotReview = {
	outcome: 'changes' | 'approved' | 'unknown';
	items: BotItem[];
	parsed: boolean;
};

const SEVERITY_RANK = {critical: 0, important: 1, required: 2};

function feedbackSeverity(heading: string): BotItem['severity'] | null {
	if (heading.includes('Critical')) return 'critical';
	if (heading.includes('Important')) return 'important';
	return null;
}

export function parseBotReview(body: string): BotReview {
	const outcome = /Review outcome \| 🔴/.test(body) ? 'changes' : /^✅ Approved/m.test(body) ? 'approved' : 'unknown';

	const fileItems: BotItem[] = [];
	const generalItems: BotItem[] = [];
	const requiredItems: BotItem[] = [];
	let section = '';
	let heading = '';
	let awaitingSummary: BotItem | null = null;

	for (const line of body.split('\n')) {
		if (line.startsWith('## ')) {
			section = line.slice(3).trim();
			heading = '';
			awaitingSummary = null;
			continue;
		}
		if (line.startsWith('### ')) {
			heading = line.slice(4).trim();
			awaitingSummary = null;
			continue;
		}

		if (awaitingSummary) {
			const text = line.trim();
			if (!text) continue;
			if (!text.startsWith('```')) awaitingSummary.summary = text;
			awaitingSummary = null;
			continue;
		}

		const severity = feedbackSeverity(heading);
		if (section === 'File-by-file Feedback' && severity) {
			const match = line.match(/^- `([^`]+)`/);
			if (match) {
				awaitingSummary = {severity, summary: '', location: match[1]};
				fileItems.push(awaitingSummary);
			}
		} else if (section === 'General Feedback' && severity) {
			const match = line.match(/^- (.+)/);
			if (match) generalItems.push({severity, summary: match[1].trim(), location: null});
		} else if (section === 'Actions' && line.startsWith('#### ')) {
			const required = heading.match(/🔴 Required \| (.+)/);
			if (required) requiredItems.push({severity: 'required', summary: `${required[1].trim()}: ${line.slice(5).trim()}`, location: null});
		}
	}

	const items = [...(fileItems.length ? fileItems : generalItems), ...requiredItems]
		.filter(item => item.summary)
		.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

	return {outcome, items, parsed: outcome !== 'changes' || items.length > 0};
}
