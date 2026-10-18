import { error, json, type RequestHandler } from '@sveltejs/kit';

import { deleteStoredFiles, mutateData } from '$lib/server/storage';

export const DELETE: RequestHandler = async ({ params }) => {
	const periodId = params?.id ?? '';
	if (!periodId) error(400, 'Période ARE manquante.');

	let storedNames: string[] = [];

	const data = await mutateData((current) => {
		const period = current.periods.find((item) => item.id === periodId);
		if (!period) error(404, 'Période ARE introuvable.');

		if (period.sourceStoredName) storedNames = [period.sourceStoredName];

		const remainingPeriods = current.periods.filter((item) => item.id !== periodId);
		current.periods = remainingPeriods;
		current.monthlyInfos = current.monthlyInfos.filter((info) => info.periodId !== periodId);

		if (current.settings.activePeriodId === periodId) current.settings.activePeriodId = '';

		return current;
	});

	const deletedFiles = await deleteStoredFiles(storedNames);

	return json({
		data,
		deletedFiles,
		deletedCount: deletedFiles.length
	});
};
