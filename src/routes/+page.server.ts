import { error } from '@sveltejs/kit';

import { explainKdriveError } from '$lib/server/kdriveClient.js';
import { pullDataFromRemote } from '$lib/server/remoteSync';
import { readData } from '$lib/server/storage';

export const load = async ({ fetch, url }) => {
	let localData;
	try {
		localData = await readData();
	} catch (cause) {
		console.error('Lecture des données impossible:', cause);
		error(503, explainKdriveError(cause));
	}

	return {
		appData: await pullDataFromRemote(localData, fetch, url)
	};
};
