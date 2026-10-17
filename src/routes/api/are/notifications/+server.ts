
import { error, json, type RequestHandler } from '@sveltejs/kit';

import { analyzeAreNotification } from '$lib/server/areAnalysis';
import { extractTextFromFile } from '$lib/server/documentAnalysis';
import {
	isRemoteSyncEnabled,
	isSameDeployment,
	isSyncRequest,
	normalizeRemoteBaseUrl,
	pushDataToRemote,
	syncHeaders
} from '$lib/server/remoteSync';
import { formFile } from '$lib/server/formFile';
import { createId, mutateData, readData, saveData, writeStoredFile } from '$lib/server/storage';
import type { IntermittencePeriod } from '$lib/types';

function sanitizeFileName(name: string) {
	return name
		.normalize('NFKD')
		.replace(/[^\w.\- ]+/g, '')
		.replace(/\s+/g, '-')
		.slice(0, 120);
}

function sourceFileKey(value: string) {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9.]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function isSamePeriod(existing: IntermittencePeriod, incoming: IntermittencePeriod) {
	const sameIndemnizationStart =
		incoming.indemnizationStartDate &&
		existing.indemnizationStartDate === incoming.indemnizationStartDate;
	const sameReferencePeriod =
		incoming.referenceStartDate &&
		existing.referenceStartDate === incoming.referenceStartDate &&
		existing.referenceEndDate === incoming.referenceEndDate;
	const sameSourceFile =
		incoming.sourceFileName &&
		existing.sourceFileName &&
		sourceFileKey(existing.sourceFileName) === sourceFileKey(incoming.sourceFileName);

	return Boolean(sameIndemnizationStart || sameReferencePeriod || sameSourceFile);
}

export const POST: RequestHandler = async ({ request, url }) => {
	const form = await request.formData();
	const file = await formFile(form);


	const buffer = Buffer.from(await file.arrayBuffer());
	const localData = await readData();

	if (
		!isSyncRequest(request) &&
		isRemoteSyncEnabled(localData) &&
		!isSameDeployment(localData.settings.remoteBaseUrl, url)
	) {
		await pushDataToRemote(localData, globalThis.fetch);

		const body = new FormData();
		body.set(
			'file',
			new File([new Blob([Uint8Array.from(buffer)])], file.name, {
				type: file.type || 'application/pdf'
			})
		);

		const response = await globalThis.fetch(
			`${normalizeRemoteBaseUrl(localData.settings.remoteBaseUrl)}/api/are/notifications`,
			{
				method: 'POST',
				headers: syncHeaders(),
				body
			}
		);
		const payload = await response.json().catch(() => ({ message: 'Réponse distante illisible.' }));

		if (!response.ok) error(response.status, payload.message ?? 'Upload distant impossible.');
		if (payload.data) await saveData(payload.data);
		return json(payload);
	}

	const periodId = createId('period');
	const safeName = sanitizeFileName(file.name || 'notification-are');
	const storedName = `${periodId}-${safeName || 'notification-are'}`;

	await writeStoredFile(storedName, buffer);

	const extractedText = await extractTextFromFile(file, buffer);
	const period = analyzeAreNotification(extractedText, {
		id: periodId,
		fileName: file.name,
		storedName
	});

	const data = await mutateData((current) => {
		const existingPeriod = current.periods.find((item) => isSamePeriod(item, period));

		if (existingPeriod) period.id = existingPeriod.id;

		current.periods = [period, ...current.periods.filter((item) => item.id !== period.id)];
		current.settings.activePeriodId = period.id;

		if (period.referenceStartDate) current.settings.referenceStartDate = period.referenceStartDate;
		if (period.dailyAllowance) current.settings.minDailyAllowance = period.dailyAllowance;

		return current;
	});

	return json({
		data,
		period,
		analysis: {
			textPreview: period.sourceTextPreview,
			notes: period.analysisNotes
		}
	});
};
