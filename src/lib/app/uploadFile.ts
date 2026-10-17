import { base } from '$app/paths';

// Vercel refuses request bodies over 4.5 MB. Bigger files are sent first in 3.5 MB chunks,
// and only their staging id travels in the form.
const DIRECT_LIMIT = 4 * 1024 * 1024;
const CHUNK_SIZE = 3.5 * 1024 * 1024;

export async function appendFile(body: FormData, file: File, field = 'file') {
	if (file.size <= DIRECT_LIMIT) {
		body.set(field, file);
		return;
	}

	const stagingId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
	const parts = Math.ceil(file.size / CHUNK_SIZE);

	for (let part = 0; part < parts; part += 1) {
		const chunk = file.slice(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE);
		const response = await fetch(`${base}/api/uploads?id=${stagingId}&part=${part}`, {
			method: 'POST',
			headers: { 'content-type': 'application/octet-stream' },
			body: chunk
		});
		if (!response.ok) throw new Error(`Envoi du fichier impossible (${response.status}).`);
	}

	body.set(`${field}StagingId`, stagingId);
	body.set(`${field}Parts`, String(parts));
	body.set(`${field}Name`, file.name);
	body.set(`${field}Type`, file.type);
}
