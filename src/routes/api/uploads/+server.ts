import { error, json, type RequestHandler } from '@sveltejs/kit';

import { putStagingPart } from '$lib/server/persistence';

// Receives one chunk (< 4 MB) of a large file: POST /api/uploads?id=<stagingId>&part=<n>
export const POST: RequestHandler = async ({ request, url }) => {
	const stagingId = url.searchParams.get('id') ?? '';
	const part = Number(url.searchParams.get('part'));
	if (!/^[a-z0-9]{6,32}$/.test(stagingId) || !Number.isInteger(part) || part < 0 || part > 99) {
		error(400, 'Fragment invalide.');
	}
	const buffer = Buffer.from(await request.arrayBuffer());
	if (!buffer.length || buffer.length > 4 * 1024 * 1024) error(413, 'Fragment trop gros.');
	await putStagingPart(stagingId, part, buffer);
	return json({ ok: true });
};
