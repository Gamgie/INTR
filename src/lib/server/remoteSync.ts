import type { AppData } from '$lib/types';

const SYNC_HEADER = 'x-intr-sync';

export function isSyncRequest(request: Request) {
	return request.headers.get(SYNC_HEADER) === '1';
}

export function normalizeRemoteBaseUrl(value: string) {
	return value.trim().replace(/\/+$/, '');
}

export function isRemoteSyncEnabled(data: AppData) {
	return Boolean(data.settings.remoteSyncEnabled && data.settings.remoteBaseUrl.trim());
}

export function isSameDeployment(remoteBaseUrl: string, requestUrl: URL) {
	const remote = normalizeRemoteBaseUrl(remoteBaseUrl);
	const currentOrigin = requestUrl.origin;
	const currentPath = requestUrl.pathname.replace(/\/api\/.*$/, '').replace(/\/+$/, '');
	const current = `${currentOrigin}${currentPath}`;

	return remote === current || requestUrl.href.startsWith(`${remote}/`);
}

export async function pushDataToRemote(data: AppData, fetcher: typeof fetch) {
	if (!isRemoteSyncEnabled(data)) return { data, message: 'Synchronisation distante désactivée.' };

	const remoteBaseUrl = normalizeRemoteBaseUrl(data.settings.remoteBaseUrl);
	const response = await fetcher(`${remoteBaseUrl}/api/data`, {
		method: 'PUT',
		headers: {
			'content-type': 'application/json',
			[SYNC_HEADER]: '1'
		},
		body: JSON.stringify(data)
	});

	if (!response.ok) {
		throw new Error(`Synchronisation distante impossible (${response.status}).`);
	}

	return {
		data: (await response.json()) as AppData,
		message: `Synchronisé avec ${remoteBaseUrl}.`
	};
}

export async function pullDataFromRemote(
	localData: AppData,
	fetcher: typeof fetch,
	requestUrl: URL
) {
	if (
		!isRemoteSyncEnabled(localData) ||
		isSameDeployment(localData.settings.remoteBaseUrl, requestUrl)
	) {
		return localData;
	}

	const remoteBaseUrl = normalizeRemoteBaseUrl(localData.settings.remoteBaseUrl);
	const response = await fetcher(`${remoteBaseUrl}/api/data`, {
		headers: { [SYNC_HEADER]: '1' }
	});

	if (!response.ok) return localData;

	const remoteData = (await response.json()) as AppData;
	remoteData.settings.remoteBaseUrl = localData.settings.remoteBaseUrl;
	remoteData.settings.remoteSyncEnabled = localData.settings.remoteSyncEnabled;
	remoteData.settings.remoteLastSyncAt = new Date().toISOString();
	remoteData.settings.remoteLastSyncStatus = `Dernière lecture distante depuis ${remoteBaseUrl}.`;
	return remoteData;
}

export function syncHeaders() {
	return { [SYNC_HEADER]: '1' };
}
