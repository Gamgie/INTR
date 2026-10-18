import { error, type RequestHandler } from '@sveltejs/kit';

import { parseFolderId } from '$lib/server/kdriveImport';
import { kdriveAccess } from '$lib/server/persistence';
import { readData } from '$lib/server/storage';

// GET /api/kdrive/original?id=<fichier> : renvoie un fichier original du dossier source
// (réglage « Import depuis kDrive »), en lecture seule. Tout fichier hors de ce dossier est refusé.
export const GET: RequestHandler = async ({ url }) => {
	const access = kdriveAccess();
	if (!access) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const fileId = Number(url.searchParams.get('id'));
	if (!Number.isInteger(fileId) || fileId <= 0) error(400, 'Fichier invalide.');
	const sourceId = parseFolderId((await readData()).settings.kdriveSourceFolder);
	if (!sourceId) error(400, 'Aucun dossier source réglé.');

	const info = await access.client.info(fileId);
	if (!info || info.type !== 'file') error(404, 'Fichier introuvable.');
	let parent = Number(info.parent_id);
	for (let depth = 0; depth < 15 && parent && parent !== sourceId; depth += 1) {
		parent = Number((await access.client.info(parent))?.parent_id);
	}
	if (parent !== sourceId) error(403, 'Ce fichier n’est pas dans le dossier source.');

	const bytes = await access.client.download(fileId);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `inline; filename="${String(info.name).replace(/"/g, '')}"`
		}
	});
};
