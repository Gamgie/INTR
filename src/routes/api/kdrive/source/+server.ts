import { error, json, type RequestHandler } from '@sveltejs/kit';

import { parseFolderId, scanSourceFolder } from '$lib/server/kdriveImport';
import { kdriveConfigured } from '$lib/server/persistence';
import { readData } from '$lib/server/storage';

// GET /api/kdrive/source?folder=<url or id> : files available for import, with import status.
export const GET: RequestHandler = async ({ url }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const folderId = parseFolderId(url.searchParams.get('folder') ?? '');
	if (!folderId) error(400, 'Adresse ou identifiant de dossier kDrive invalide.');

	const [scan, data] = await Promise.all([scanSourceFolder(folderId), readData()]);
	const imported = new Map(data.kdriveImports.map((item) => [item.fileId, item]));

	return json({
		...scan,
		files: scan.files.map((file) => ({
			...file,
			status: imported.get(file.id)?.status ?? '',
			message: imported.get(file.id)?.message ?? ''
		}))
	});
};
