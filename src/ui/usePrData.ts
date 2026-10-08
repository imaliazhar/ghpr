import {useCallback, useEffect, useReducer} from 'react';
import type {Branch} from '../git.js';
import {fetchAll, type PR} from '../github.js';
import {initialPrData, prDataReducer} from '../prData.js';
import {prCache} from '../store.js';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** PRs from the cache straight away, then from GitHub on mount and on each `reload`. */
export function usePrData(branch: Promise<Branch | null>) {
	const [data, dispatch] = useReducer(prDataReducer, null, () => initialPrData(prCache.load()));

	useEffect(() => {
		branch.then(b => dispatch({type: 'branchKnown', branch: b}));
	}, [branch]);

	const reload = useCallback(async () => {
		dispatch({type: 'fetchStarted'});
		try {
			const result = await fetchAll(await branch);
			prCache.save(result.mine);
			dispatch({type: 'fetched', ...result, at: Date.now()});
		} catch (e) {
			dispatch({type: 'fetchFailed', error: errorText(e)});
		}
	}, [branch]);

	useEffect(() => {
		reload();
	}, [reload]);

	const patch = useCallback((url: string, patch: (pr: PR) => PR) => dispatch({type: 'patched', url, patch}), []);

	return {...data, reload, patch};
}
