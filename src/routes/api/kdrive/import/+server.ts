import { error, json, type RequestHandler } from '@sveltejs/kit';

import { downloadSourceFile } from '$lib/server/kdriveImport';
import { kdriveConfigured } from '$lib/server/persistence';
import { mutateData } from '$lib/server/storage';
import type { KdriveImport } from '$lib/types';

// POST /api/kdrive/import { fileId, path } : copies one original from kDrive into the app,
// through the same analysis as a manual import. The original file is only read.
export const POST: RequestHandler = async ({ request, fetch }) => {
	if (!kdriveConfigured()) error(404, 'kDrive n’est pas configuré sur ce serveur.');
	const { fileId, path } = (await request.json().catch(() => ({}))) as {
		fileId?: number;
		path?: string;
	};
	const id = Number(fileId);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Fichier kDrive invalide.');

	const record: KdriveImport = {
		fileId: id,
		path: String(path ?? ''),
		size: 0,
		importedAt: new Date().toISOString(),
		status: 'importé',
		message: '',
		documentIds: [],
		periodIds: []
	};
	let payload: Record<string, unknown> = {};

	try {
		const source = await downloadSourceFile(id);
		record.size = source.bytes.length;
		const lower = source.name.toLowerCase();
		const type = lower.endsWith('.pdf')
			? 'application/pdf'
			: lower.endsWith('.png')
				? 'image/png'
				: 'image/jpeg';

		// Same pipeline as the « Importer » button (classification, splitting, OCR, routing).
		const body = new FormData();
		body.set('autoRoute', 'true');
		body.set('kind', 'Autre');
		body.set('file', new File([new Uint8Array(source.bytes)], source.name, { type }));
		const response = await fetch('/api/documents', { method: 'POST', body });
		payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

		if (!response.ok) {
			record.status = 'erreur';
			record.message = String(payload.message ?? `Erreur ${response.status}`);
		} else {
			record.documentIds = Array.isArray(payload.documentIds) ? payload.documentIds.map(String) : [];
			record.periodIds = Array.isArray(payload.periodIds) ? payload.periodIds.map(String) : [];
		}
	} catch (cause) {
		record.status = 'erreur';
		record.message = cause instanceof Error ? cause.message : String(cause);
	}

	const data = await mutateData((current) => {
		current.kdriveImports = [
			...current.kdriveImports.filter((item) => item.fileId !== id),
			record
		];
	});

	return json({ ...payload, data, record }, { status: record.status === 'erreur' ? 422 : 200 });
};
