import { error, json, type RequestHandler } from '@sveltejs/kit';

import { explainKdriveError } from '$lib/server/kdriveClient.js';
import { moveAndRename } from '$lib/server/kdriveOrganize';
import { kdriveConfigured } from '$lib/server/persistence';
import { mutateData, readData } from '$lib/server/storage';

// POST /api/kdrive/organize/undo { batchId, fileId } : puts one file back where it was.
export const POST: RequestHandler = async ({ request }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const { batchId, fileId } = (await request.json().catch(() => ({}))) as { batchId?: string; fileId?: number };
	const entry = (await readData()).kdriveMoves.find(
		(item) => item.batchId === batchId && item.fileId === Number(fileId) && !item.undone
	);
	if (!entry) error(404, 'Déplacement introuvable ou déjà annulé.');

	try {
		const finalName = await moveAndRename(entry.fileId, entry.fromParentId, entry.toParentId, entry.toName, entry.fromName);
		const data = await mutateData((current) => {
			const stored = current.kdriveMoves.find(
				(item) => item.batchId === entry.batchId && item.fileId === entry.fileId && !item.undone
			);
			if (stored) stored.undone = true;
			const record = current.kdriveImports.find((item) => item.fileId === entry.fileId);
			if (record) record.path = entry.fromPath.replace(/[^/]+$/, finalName);
		});
		return json({ ok: true, data });
	} catch (cause) {
		return json({ ok: false, message: explainKdriveError(cause) }, { status: 502 });
	}
};
