import { error } from '@sveltejs/kit';

import { takeStagedFile } from '$lib/server/persistence';

// Returns the uploaded file, whether it came inline in the form or was staged in Storage first.
export async function formFile(form: FormData, field = 'file'): Promise<File> {
	const file = form.get(field);
	if (file instanceof File) return file;

	const stagedName = String(form.get(`${field}StagedName`) ?? '');
	if (!stagedName) error(400, 'Fichier manquant.');

	const fileName = String(form.get(`${field}Name`) ?? '') || 'document.pdf';
	const type = String(form.get(`${field}Type`) ?? '') || 'application/pdf';
	const buffer = await takeStagedFile(stagedName);
	return new File([new Uint8Array(buffer)], fileName, { type });
}
