import { base } from '$app/paths';

// Vercel refuses request bodies over 4.5 MB. Above this size, the file is first sent
// straight to storage through a signed URL, and only its name travels in the form.
const DIRECT_LIMIT = 4 * 1024 * 1024;

export async function appendFile(body: FormData, file: File, field = 'file') {
	if (file.size <= DIRECT_LIMIT) {
		body.set(field, file);
		return;
	}

	const signResponse = await fetch(`${base}/api/uploads`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ fileName: file.name })
	});

	if (signResponse.status === 404) {
		body.set(field, file);
		return;
	}
	if (!signResponse.ok) throw new Error('Préparation de l’envoi impossible.');

	const { stagedName, signedUrl } = (await signResponse.json()) as {
		stagedName: string;
		signedUrl: string;
	};
	const upload = await fetch(signedUrl, {
		method: 'PUT',
		headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
		body: file
	});
	if (!upload.ok) throw new Error(`Envoi du fichier impossible (${upload.status}).`);

	body.set(`${field}StagedName`, stagedName);
	body.set(`${field}Name`, file.name);
	body.set(`${field}Type`, file.type);
}
