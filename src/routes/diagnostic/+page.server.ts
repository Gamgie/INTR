import { env } from '$env/dynamic/private';

import { explainKdriveError, KdriveClient } from '$lib/server/kdriveClient.js';
import { DATA_FILE_NAME } from '$lib/server/persistence';

type Step = { label: string; ok: boolean | null; detail: string };

// Checks the kDrive setup step by step. Never shows the token, only whether it is set.
export const load = async (): Promise<{ steps: Step[] }> => {
	const steps: Step[] = [];
	const token = env.KDRIVE_TOKEN?.trim() ?? '';
	const driveId = env.KDRIVE_DRIVE_ID?.trim() ?? '';
	const folderId = env.KDRIVE_FOLDER_ID?.trim() ?? '';

	steps.push({
		label: 'Variables dans Vercel',
		ok: Boolean(token && driveId && folderId && env.ACCESS_PASSWORD?.trim()),
		detail: [
			`ACCESS_PASSWORD ${env.ACCESS_PASSWORD?.trim() ? 'définie' : 'MANQUANTE'}`,
			`KDRIVE_TOKEN ${token ? `défini (${token.length} caractères)` : 'MANQUANT'}`,
			`KDRIVE_DRIVE_ID ${driveId ? `= ${driveId}` : 'MANQUANT'}`,
			`KDRIVE_FOLDER_ID ${folderId ? `= ${folderId}` : 'MANQUANT'}`
		].join(' · ')
	});

	const numeric = /^\d+$/;
	if (driveId && !numeric.test(driveId)) {
		steps.push({ label: 'Format', ok: false, detail: 'KDRIVE_DRIVE_ID doit être un nombre seul (ex. 3830432), sans espace ni adresse.' });
	}
	if (folderId && !numeric.test(folderId)) {
		steps.push({ label: 'Format', ok: false, detail: 'KDRIVE_FOLDER_ID doit être un nombre seul (le dernier nombre de l’adresse du dossier).' });
	}
	if (folderId === '7890') {
		steps.push({ label: 'Format', ok: false, detail: 'KDRIVE_FOLDER_ID vaut 7890, le nombre d’exemple du guide : remplace-le par le dernier nombre de l’adresse de ton dossier INTR dans kDrive.' });
	}
	if (/\s/.test(token)) {
		steps.push({ label: 'Format', ok: false, detail: 'KDRIVE_TOKEN contient un espace ou un retour à la ligne : recolle-le sans rien autour.' });
	}
	if (!token || !driveId || !folderId) return { steps };

	const client = new KdriveClient({ token, driveId });

	const run = async (label: string, action: () => Promise<string>) => {
		try {
			steps.push({ label, ok: true, detail: await action() });
			return true;
		} catch (cause) {
			steps.push({ label, ok: false, detail: explainKdriveError(cause) });
			return false;
		}
	};

	if (!(await run('Jeton et kDrive', async () => {
		const drive = await client.drive();
		return `kDrive trouvé : « ${drive?.name ?? driveId} ».`;
	}))) return { steps };

	if (!(await run('Dossier de l’app', async () => {
		const folder = await client.info(folderId);
		if (folder?.type !== 'dir') throw new Error(`L’élément ${folderId} est un fichier, pas un dossier.`);
		return `Dossier trouvé : « ${folder.name} ».`;
	}))) return { steps };

	if (!(await run('Lecture du dossier', async () => {
		const items = await client.list(folderId);
		const hasData = items.some((item) => item.type === 'file' && item.name === DATA_FILE_NAME);
		return `${items.length} élément(s). ${hasData ? `${DATA_FILE_NAME} présent.` : `${DATA_FILE_NAME} pas encore créé.`}`;
	}))) return { steps };

	await run('Écriture d’essai', async () => {
		const file = await client.upload({
			directoryId: folderId,
			name: 'intr-diagnostic.txt',
			data: new TextEncoder().encode(`Test d'écriture INTR ${new Date().toISOString()}\n`)
		});
		if (file?.id) await client.trash(file.id);
		return 'Fichier d’essai écrit puis mis à la corbeille.';
	});

	return { steps };
};
