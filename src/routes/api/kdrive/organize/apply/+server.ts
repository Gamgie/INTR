import { error, json, type RequestHandler } from '@sveltejs/kit';

import { explainKdriveError } from '$lib/server/kdriveClient.js';
import { ensurePath, moveAndRename } from '$lib/server/kdriveOrganize';
import { kdriveConfigured } from '$lib/server/persistence';
import { mutateData } from '$lib/server/storage';
import type { OrganizeMove } from '$lib/organize';

const SAFE_SEGMENT = /^[^/\\\0]{1,120}$/;

// POST /api/kdrive/organize/apply { folderId, batchId, move } : applies one move of the plan.
export const POST: RequestHandler = async ({ request }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const { folderId, batchId, move } = (await request.json().catch(() => ({}))) as {
		folderId?: number;
		batchId?: string;
		move?: OrganizeMove;
	};
	const sourceId = Number(folderId);
	if (!Number.isInteger(sourceId) || sourceId <= 0 || !move || !batchId) error(400, 'Déplacement invalide.');
	if (
		!Array.isArray(move.toDirs) ||
		!move.toDirs.length ||
		move.toDirs.length > 5 ||
		![...move.toDirs, move.toName].every((part) => SAFE_SEGMENT.test(part) && part !== '.' && part !== '..')
	) {
		error(400, 'Chemin de destination invalide.');
	}

	try {
		const destinationId = await ensurePath(sourceId, move.toDirs);
		const finalName = await moveAndRename(move.fileId, destinationId, move.fromParentId, move.fromName, move.toName);
		const toPath = `${move.toDirs.join('/')}/${finalName}`;

		const data = await mutateData((current) => {
			current.kdriveMoves.push({
				batchId,
				fileId: move.fileId,
				fromParentId: move.fromParentId,
				fromName: move.fromName,
				fromPath: move.fromPath,
				toParentId: destinationId,
				toName: finalName,
				toPath,
				at: new Date().toISOString(),
				undone: false
			});
			const record = current.kdriveImports.find((item) => item.fileId === move.fileId);
			if (record) record.path = toPath;
		});
		return json({ ok: true, toPath, data });
	} catch (cause) {
		return json({ ok: false, message: explainKdriveError(cause) }, { status: 502 });
	}
};
