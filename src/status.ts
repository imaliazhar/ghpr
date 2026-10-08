import type {PR} from './github.js';

export type Status = 'ready' | 'blocked' | 'failing' | 'pending' | 'botReview' | 'approval';

export const STATUS_ORDER: Status[] = ['ready', 'blocked', 'failing', 'pending', 'botReview', 'approval'];

export const STATUS_META: Record<Status, {icon: string; label: string; color: string}> = {
	ready: {icon: '✔', label: 'ready to merge', color: 'green'},
	blocked: {icon: '⊘', label: 'bot blocking', color: 'red'},
	failing: {icon: '✗', label: 'checks failing', color: 'redBright'},
	pending: {icon: '●', label: 'checks running', color: 'yellow'},
	botReview: {icon: '◎', label: 'in bot review', color: 'gray'},
	approval: {icon: '◌', label: 'needs approval', color: 'magenta'},
};

export const TUNNEL_LABEL = 'tunnel-review-vision';
export const IN_REVIEW_LABEL = 'in-review';

export const hasLabel = (pr: PR, name: string) => pr.labels.some(l => l.name === name);

export function statusOf(pr: PR): Status {
	if (pr.bot?.outcome === 'changes') return 'blocked';
	if (hasLabel(pr, TUNNEL_LABEL)) return 'botReview';
	if (pr.requiredChecks.some(c => c.state === 'failing')) return 'failing';
	if (pr.requiredChecks.some(c => c.state === 'pending')) return 'pending';
	return pr.reviewDecision === null || pr.reviewDecision === 'APPROVED' ? 'ready' : 'approval';
}
