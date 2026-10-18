import { error, json, type RequestHandler } from '@sveltejs/kit';

import { readData, saveData } from '$lib/server/storage';
import {
	isSameDeployment,
	isSyncRequest,
	pullDataFromRemote,
	pushDataToRemote
} from '$lib/server/remoteSync';
import type { AppData } from '$lib/types';

export const GET: RequestHandler = async ({ request, url, fetch }) => {
	const localData = await readData();

	if (!isSyncRequest(request) && !isSameDeployment(localData.settings.remoteBaseUrl, url)) {
		const synced = await pullDataFromRemote(localData, fetch, url);
		if (synced !== localData) return json(await saveData(synced));
	}

	return json(localData);
};

export const PUT: RequestHandler = async ({ request, url, fetch }) => {
	try {
		const payload = (await request.json()) as AppData;
		// Une page restée ouverte avec d'anciennes données ne doit pas écraser ce qui a été
		// enregistré depuis (import, autre appareil) : elle reçoit les données à jour à la place.
		if (request.headers.get('x-intr-force') !== '1') {
			const current = await readData();
			if (payload.updatedAt && current.updatedAt && payload.updatedAt < current.updatedAt) {
				return json(
					{
						message: 'Les données ont changé depuis l’ouverture de la page : elles ont été rechargées.',
						data: current
					},
					{ status: 409 }
				);
			}
		}
		let saved = await saveData(payload);

		if (!isSyncRequest(request) && !isSameDeployment(saved.settings.remoteBaseUrl, url)) {
			const remote = await pushDataToRemote(saved, fetch);
			saved = await saveData(remote.data);
			saved.settings.remoteLastSyncAt = new Date().toISOString();
			saved.settings.remoteLastSyncStatus = remote.message;
			saved = await saveData(saved);
		}

		return json(saved);
	} catch (cause) {
		console.error(cause);
		error(400, cause instanceof Error ? cause.message : 'Impossible de sauvegarder les données.');
	}
};
