import { error } from '@sveltejs/kit';

import { takeStagedFile } from '$lib/server/persistence';

// Returns the uploaded file, whether it came inline in the form or in staged chunks.
export async function formFile(form: FormData, field = 'file'): Promise<File> {
	const file = form.get(field);
	if (file instanceof File) return file;

	const stagingId = String(form.get(`${field}StagingId`) ?? '');
	const parts = Number(form.get(`${field}Parts`) ?? 0);
	if (!stagingId || !parts) error(400, 'Fichier manquant.');

	const fileName = String(form.get(`${field}Name`) ?? '') || 'document.pdf';
	const type = String(form.get(`${field}Type`) ?? '') || 'application/pdf';
	const buffer = await takeStagedFile(stagingId, parts);
	return new File([new Uint8Array(buffer)], fileName, { type });
}
