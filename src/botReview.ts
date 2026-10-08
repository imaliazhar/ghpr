export const BOT_MARKER = '<!-- request-review:human-readable -->';

export type BotSeverity = 'critical' | 'important' | 'required' | 'warning' | 'win';

export type BotItem = {
	severity: BotSeverity;
	summary: string;
	/** A file path with line range, for file feedback. */
	location: string | null;
	/** The longer explanation, for actions. */
	detail: string | null;
	/** Lines of the example snippet, without the fences. */
	code: string[];
};

export type BotReview = {
	outcome: 'changes' | 'approved' | 'unknown';
	/** The implementation strategy score (like "3.6/5 Good") and its summary. */
	strategy: {score: string | null; summary: string} | null;
	items: BotItem[];
	parsed: boolean;
};

const SEVERITY_RANK: Record<BotSeverity, number> = {critical: 0, important: 1, required: 2, warning: 3, win: 4};
const BLOCKING = new Set<BotSeverity>(['critical', 'important', 'required']);

function feedbackSeverity(heading: string): BotSeverity | null {
	if (heading.includes('Critical')) return 'critical';
	if (heading.includes('Important')) return 'important';
	if (heading.includes('Warning')) return 'warning';
	if (heading.includes('Wins')) return 'win';
	return null;
}

/** The topic of a required action heading, or null for any other heading. */
function requiredTopic(heading: string): string | null {
	return heading.match(/Required \| (.+)/)?.[1].trim() ?? null;
}

/** Removes the common leading indentation from snippet lines. */
function dedent(lines: string[]) {
	const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length));
	return lines.map(l => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd());
}

export function parseBotReview(body: string): BotReview {
	const outcome = /Review outcome \| 🔴/.test(body) ? 'changes' : /^✅ Approved/m.test(body) ? 'approved' : 'unknown';

	const fileItems: BotItem[] = [];
	const generalItems: BotItem[] = [];
	const actionItems: BotItem[] = [];
	let strategy: BotReview['strategy'] = null;
	let section = '';
	let heading = '';
	let current: BotItem | null = null;
	let code: string[] | null = null;
	let inDetails = false;

	for (const line of body.split('\n')) {
		const text = line.trim();

		if (code) {
			if (text.startsWith('```')) {
				if (current) current.code = dedent(code);
				code = null;
			} else code.push(line);
			continue;
		}
		if (inDetails) {
			if (text.startsWith('</details>')) inDetails = false;
			continue;
		}
		if (text.startsWith('- <details>') || text.startsWith('<details>')) {
			inDetails = true;
			continue;
		}

		if (line.startsWith('## ')) {
			section = line.slice(3).trim();
			heading = '';
			current = null;
			if (section.startsWith('Implementation Strategy')) {
				const score = section.match(/Score&message=([^&"]+)/);
				strategy = {score: score ? decodeURIComponent(score[1]) : null, summary: ''};
			}
			continue;
		}
		if (line.startsWith('### ')) {
			heading = line.slice(4).trim();
			current = null;
			continue;
		}
		if (text.startsWith('```')) {
			code = [];
			continue;
		}

		if (section.startsWith('Implementation Strategy')) {
			if (strategy && !strategy.summary && text && !text.startsWith('|')) strategy.summary = text;
			continue;
		}

		const severity = feedbackSeverity(heading);
		if (section === 'File-by-file Feedback' && severity) {
			const match = line.match(/^- `([^`]+)`/);
			if (match) {
				current = {severity, summary: '', location: match[1], detail: null, code: []};
				fileItems.push(current);
			} else if (current && !current.summary && text) current.summary = text;
		} else if (section === 'General Feedback' && severity) {
			const match = line.match(/^- (.+)/);
			if (match) generalItems.push({severity, summary: match[1].trim(), location: null, detail: null, code: []});
		} else if (section === 'Actions') {
			const topic = requiredTopic(heading);
			if (!topic) continue;
			if (line.startsWith('#### ')) {
				current = {severity: 'required', summary: `${topic}: ${line.slice(5).trim()}`, location: null, detail: null, code: []};
				actionItems.push(current);
			} else if (current && !current.detail && text && !text.startsWith('-')) current.detail = text;
		}
	}

	const fileSeverities = new Set(fileItems.map(i => i.severity));
	const items = [...fileItems, ...generalItems.filter(i => !fileSeverities.has(i.severity)), ...actionItems]
		.filter(item => item.summary)
		.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

	return {outcome, strategy, items, parsed: outcome !== 'changes' || items.some(i => BLOCKING.has(i.severity))};
}

/** The findings worth showing: what blocks merge, or once approved, its warnings and wins too. */
export const shownItems = (review: BotReview) =>
	review.outcome === 'approved' ? review.items : review.items.filter(i => BLOCKING.has(i.severity));
