import { error, json, type RequestHandler } from '@sveltejs/kit';

import { explainKdriveError } from '$lib/server/kdriveClient.js';
import { parseFolderId } from '$lib/server/kdriveImport';
import { trashEmptyFolders } from '$lib/server/kdriveOrganize';
import { kdriveConfigured } from '$lib/server/persistence';

// POST /api/kdrive/organize/empty { folder } : empty folders left behind go to the kDrive trash.
export const POST: RequestHandler = async ({ request }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const { folder } = (await request.json().catch(() => ({}))) as { folder?: string };
	const folderId = parseFolderId(String(folder ?? ''));
	if (!folderId) error(400, 'Dossier invalide.');
	try {
		return json({ ok: true, trashed: await trashEmptyFolders(folderId) });
	} catch (cause) {
		return json({ ok: false, message: explainKdriveError(cause) }, { status: 502 });
	}
};
