import { error, json, type RequestHandler } from '@sveltejs/kit';

import { explainKdriveError } from '$lib/server/kdriveClient.js';
import { parseFolderId, scanSourceFolder } from '$lib/server/kdriveImport';
import { forgetFolders } from '$lib/server/kdriveOrganize';
import { kdriveConfigured } from '$lib/server/persistence';
import { readData } from '$lib/server/storage';
import { buildOrganizePlan } from '$lib/organize';

// GET /api/kdrive/organize?folder=… : the plan, without touching anything.
export const GET: RequestHandler = async ({ url }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const folderId = parseFolderId(url.searchParams.get('folder') ?? '');
	if (!folderId) error(400, 'Adresse ou identifiant de dossier kDrive invalide.');
	try {
		forgetFolders(folderId);
		const [scan, data] = await Promise.all([scanSourceFolder(folderId), readData()]);
		const plan = buildOrganizePlan(data, scan.files);
		return json({ folder: scan.folder, truncated: scan.truncated, ...plan });
	} catch (cause) {
		error(502, explainKdriveError(cause));
	}
};
