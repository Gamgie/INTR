import { error, json, type RequestHandler } from '@sveltejs/kit';

import { analyzeDocumentText, extractTextFromBuffer } from '$lib/server/documentAnalysis';
import { mutateData, readData, readStoredFile } from '$lib/server/storage';

const BATCH = 5;

// POST /api/documents/reread { ids } : relit le texte de quelques documents importés à partir de
// leur copie (OCR compris) et met à jour l'extrait gardé, en une seule écriture de la base.
// Ne touche ni aux contrats ni aux montants.
export const POST: RequestHandler = async ({ request }) => {
	const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };
	if (!Array.isArray(ids) || !ids.length || ids.length > BATCH) error(400, `Donner 1 à ${BATCH} documents.`);

	const documents = (await readData()).documents.filter((item) => ids.includes(item.id));
	const previews = new Map<string, string>();
	const failures: { id: string; message: string }[] = [];

	for (const document of documents) {
		try {
			const buffer = await readStoredFile(document.storedName);
			const text = await extractTextFromBuffer(document.fileName, document.mimeType, buffer);
			const preview = analyzeDocumentText(text).textPreview;
			if (preview) previews.set(document.id, preview);
		} catch (cause) {
			failures.push({ id: document.id, message: cause instanceof Error ? cause.message : String(cause) });
		}
	}

	if (previews.size) {
		await mutateData((current) => {
			for (const stored of current.documents) {
				const preview = previews.get(stored.id);
				if (preview) stored.extractedTextPreview = preview;
			}
		});
	}
	return json({ ok: true, reread: previews.size, failures });
};
