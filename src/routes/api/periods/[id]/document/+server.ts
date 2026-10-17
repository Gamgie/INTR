import { error, type RequestHandler } from '@sveltejs/kit';

import { readData, readStoredFile } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params }) => {
	const data = await readData();
	const period = data.periods.find((item) => item.id === params.id);

	if (!period || !period.sourceStoredName) error(404, 'Document introuvable.');

	const file = await readStoredFile(period.sourceStoredName);

	return new Response(new Uint8Array(file), {
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `inline; filename="${period.sourceFileName.replace(/"/g, '')}"`
		}
	});
};
