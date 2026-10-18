import { error, json, type RequestHandler } from '@sveltejs/kit';

import { kdriveAccess } from '$lib/server/persistence';
import { parseFolderId, scanSourceFolder } from '$lib/server/kdriveImport';
import { saveToSource, sourcePlace } from '$lib/server/sourceArchive';
import { mutateData, readData, readStoredFile } from '$lib/server/storage';
import type { KdriveImport } from '$lib/types';

// Le kDrive fait foi. GET : les fichiers importés qui ne sont plus dans le dossier source (et
// s'ils sont dans la corbeille), et les documents de l'app sans original dans kDrive.
// POST { restore: [fileId] } : remet des fichiers de la corbeille à leur place.
// POST { upload: [documentId] } : recrée l'original d'un document à partir de la copie de l'app.
export const GET: RequestHandler = async () => {
	const access = kdriveAccess();
	if (!access) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const data = await readData();
	const sourceId = parseFolderId(data.settings.kdriveSourceFolder);
	if (!sourceId) error(400, 'Aucun dossier source réglé.');

	const present = new Set((await scanSourceFolder(sourceId)).files.map((file) => file.id));
	const missing = [];
	for (const record of data.kdriveImports.filter((item) => !present.has(item.fileId))) {
		let trash: unknown = null;
		try {
			trash = await access.client.trashed(record.fileId);
		} catch (cause) {
			trash = { absent: true, status: (cause as { status?: number }).status ?? 0 };
		}
		const documents = record.documentIds.filter((id) => data.documents.some((document) => document.id === id));
		missing.push({ fileId: record.fileId, path: record.path, documentsInApp: documents, trash });
	}
	const covered = new Set(
		data.kdriveImports.filter((item) => present.has(item.fileId)).flatMap((item) => item.documentIds)
	);
	const withoutOriginal = data.documents
		.filter((document) => !covered.has(document.id))
		.map((document) => ({
			id: document.id,
			kind: document.kind,
			fileName: document.fileName,
			contract: data.contracts.find((contract) => contract.id === document.contractId)?.title ?? ''
		}));
	return json({ missing, withoutOriginal });
};

export const POST: RequestHandler = async ({ request }) => {
	const access = kdriveAccess();
	if (!access) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const body = (await request.json().catch(() => ({}))) as { restore?: number[]; upload?: string[] };
	const results: unknown[] = [];

	for (const fileId of (body.restore ?? []).slice(0, 20)) {
		try {
			await access.client.restore(fileId);
			results.push({ fileId, restored: true });
		} catch (cause) {
			results.push({ fileId, restored: false, message: cause instanceof Error ? cause.message : String(cause) });
		}
	}

	const data = await readData();
	const records: KdriveImport[] = [];
	for (const documentId of (body.upload ?? []).slice(0, 10)) {
		const document = data.documents.find((item) => item.id === documentId);
		const contract = data.contracts.find((item) => item.id === document?.contractId);
		if (!document || !contract) {
			results.push({ documentId, uploaded: false, message: 'Document ou contrat introuvable.' });
			continue;
		}
		try {
			const extension = document.fileName.match(/\.[a-z0-9]{2,4}$/i)?.[0]?.toLowerCase() ?? '.pdf';
			const place = sourcePlace(data, contract, [document.kind], extension);
			const bytes = new Uint8Array(await readStoredFile(document.storedName));
			const saved = await saveToSource(data.settings.kdriveSourceFolder, place.folders, place.name, bytes);
			records.push({
				fileId: saved.id,
				path: saved.path,
				size: bytes.byteLength,
				importedAt: new Date().toISOString(),
				status: 'importé',
				message: 'Original recréé dans kDrive à partir de la copie gardée par l’app.',
				documentIds: [document.id],
				periodIds: []
			});
			results.push({ documentId, uploaded: true, path: saved.path, created: saved.created });
		} catch (cause) {
			results.push({ documentId, uploaded: false, message: cause instanceof Error ? cause.message : String(cause) });
		}
	}
	if (records.length) {
		await mutateData((current) => {
			const ids = new Set(records.map((record) => record.fileId));
			current.kdriveImports = [...current.kdriveImports.filter((item) => !ids.has(item.fileId)), ...records];
		});
	}
	return json({ results });
};
