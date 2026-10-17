import { json, type RequestHandler } from '@sveltejs/kit';

import { createStagingUpload } from '$lib/server/persistence';

export const POST: RequestHandler = async ({ request }) => {
	const { fileName } = (await request.json().catch(() => ({}))) as { fileName?: string };
	const upload = await createStagingUpload(String(fileName ?? 'document'));
	if (!upload) return json({ message: 'Envoi direct non disponible.' }, { status: 404 });
	return json(upload);
};
