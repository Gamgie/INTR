import { error, json, type RequestHandler } from '@sveltejs/kit';

import { downloadSourceFile } from '$lib/server/kdriveImport';
import { kdriveConfigured } from '$lib/server/persistence';
import { splitIntoBundles } from '$lib/server/pdfParts';
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

		// Un PDF qui regroupe plusieurs paies est importé lot par lot (un bulletin avec son AEM et
		// son certificat), chaque lot passant par la même analyse que le bouton « Importer »
		// (classement, OCR, rattachement à son contrat).
		const bundles =
			type === 'application/pdf'
				? await splitIntoBundles(source.name, Buffer.from(source.bytes))
				: [{ fileName: source.name, buffer: Buffer.from(source.bytes) }];
		const errors: string[] = [];
		for (const bundle of bundles) {
			const body = new FormData();
			body.set('autoRoute', 'true');
			body.set('kind', 'Autre');
			body.set('file', new File([new Uint8Array(bundle.buffer)], bundle.fileName, { type }));
			const response = await fetch('/api/documents', { method: 'POST', body });
			payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

			if (!response.ok) {
				errors.push(String(payload.message ?? `Erreur ${response.status}`));
				continue;
			}
			if (Array.isArray(payload.documentIds)) record.documentIds.push(...payload.documentIds.map(String));
			if (Array.isArray(payload.periodIds)) record.periodIds.push(...payload.periodIds.map(String));
		}
		if (errors.length) {
			record.status = 'erreur';
			record.message = errors.join(' ; ');
		} else if (bundles.length > 1) {
			record.message = `PDF découpé en ${bundles.length} paies, chacune rattachée à son contrat.`;
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
