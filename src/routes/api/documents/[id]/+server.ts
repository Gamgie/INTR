import { error, json, type RequestHandler } from '@sveltejs/kit';

import { deleteStoredFiles, mutateData, readData, readStoredFile } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params }) => {
	const data = await readData();
	const document = data.documents.find((item) => item.id === params.id);

	if (!document) error(404, 'Document introuvable.');

	const file = await readStoredFile(document.storedName);

	return new Response(new Uint8Array(file), {
		headers: {
			'content-type': document.mimeType,
			'content-disposition': `inline; filename="${document.fileName.replace(/"/g, '')}"`
		}
	});
};

export const DELETE: RequestHandler = async ({ params }) => {
	const documentId = params.id ?? '';
	if (!documentId) error(400, 'Document manquant.');

	let storedName = '';
	const data = await mutateData((current) => {
		const document = current.documents.find((item) => item.id === documentId);
		if (!document) error(404, 'Document introuvable.');

		storedName = document.storedName;
		current.documents = current.documents.filter((item) => item.id !== documentId);

		for (const contract of current.contracts) {
			if (!contract.documentIds.includes(documentId)) continue;

			contract.documentIds = contract.documentIds.filter((id) => id !== documentId);
			contract.updatedAt = new Date().toISOString();
		}

		return current;
	});

	const storedFileStillUsed =
		Boolean(storedName) &&
		(data.documents.some((document) => document.storedName === storedName) ||
			data.periods.some((period) => period.sourceStoredName === storedName));
	const deletedFiles = storedFileStillUsed ? [] : await deleteStoredFiles([storedName]);

	return json({
		data,
		deletedFiles,
		deletedCount: deletedFiles.length
	});
};
