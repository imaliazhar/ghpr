import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {PR} from './github.js';

const run = promisify(execFile);

export type Branch = {owner: string; name: string; branch: string};

export async function currentBranch(): Promise<Branch | null> {
	try {
		const [remote, branch] = await Promise.all([
			run('git', ['remote', 'get-url', 'origin']),
			run('git', ['branch', '--show-current']),
		]);
		const match = remote.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
		const name = branch.stdout.trim();
		return match && name ? {owner: match[1], name: match[2], branch: name} : null;
	} catch {
		return null;
	}
}

export const findBranchPr = (prs: PR[], branch: Branch) =>
	prs.find(p => p.repo.toLowerCase() === `${branch.owner}/${branch.name}`.toLowerCase() && p.headRef === branch.branch) ?? null;
