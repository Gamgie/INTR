import { currentIntermittenceYear, yearOfDate } from '$lib/years';
import { kdriveAccess } from '$lib/server/persistence';
import { parseFolderId } from '$lib/server/kdriveImport';
import type { AppData, Contract, DocumentKind } from '$lib/types';

// Le kDrive de Clément fait foi : chaque document reçu doit y avoir son original, rangé comme
// le reste du dossier source.
//   année en cours     : « 2026/07/Compagnie Gamgie/[BP+AEM+CS] 2026-07-18 Compagnie Gamgie.pdf »
//   années précédentes : « Archive/2024/10/Compagnie Gamgie/[CT] 2024-10-21 Compagnie Gamgie.pdf »
// L'année est l'année d'intermittence, le mois et la date sont ceux du début du contrat.

const CODES: Partial<Record<DocumentKind, string>> = {
	'Fiche de paie': 'BP',
	AEM: 'AEM',
	'Congé Spectacle': 'CS',
	Contrat: 'CT',
	'Déclaration Guso': 'GUSO',
	'Notification ARE': 'ARE'
};
const ORDER = ['BP', 'AEM', 'CS', 'CT', 'GUSO', 'ARE', 'DOC'];

const clean = (value: string) => value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

export function sourcePlace(data: AppData, contract: Contract, kinds: DocumentKind[], extension = '.pdf') {
	const company = data.companies.find((item) => item.id === contract.companyId);
	const employer = clean(company?.name || 'Employeur inconnu');
	const date = contract.startDate || new Date().toISOString().slice(0, 10);
	const year = yearOfDate(data, date) ?? Number(date.slice(0, 4));
	const current = currentIntermittenceYear(data)?.year;
	const codes = [...new Set(kinds.map((kind) => CODES[kind] ?? 'DOC'))].sort(
		(a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)
	);
	const folders = [
		...(year === current ? [] : ['Archive']),
		String(year),
		date.slice(5, 7),
		employer
	];
	return { folders, name: `[${codes.join('+')}] ${date} ${employer}${extension}` };
}

/** Dépose un fichier dans le dossier source, en créant les dossiers ; ne remplace jamais un fichier. */
export async function saveToSource(sourceFolder: string, folders: string[], name: string, data: Uint8Array) {
	const access = kdriveAccess();
	const sourceId = parseFolderId(sourceFolder);
	if (!access || !sourceId) throw new Error('Dossier kDrive source non réglé.');

	let parentId: number = sourceId;
	for (const folder of folders) parentId = Number((await access.client.ensureDirectory(parentId, folder)).id);

	const existing = await access.client.list(parentId);
	const same = existing.find((item) => item.type === 'file' && item.name === name && item.size === data.byteLength);
	if (same) return { id: same.id, path: [...folders, name].join('/'), created: false };

	let finalName = name;
	const dot = name.lastIndexOf('.');
	for (let index = 2; existing.some((item) => item.name === finalName); index += 1) {
		finalName = `${name.slice(0, dot)} (${index})${name.slice(dot)}`;
	}
	const uploaded = await access.client.upload({ directoryId: parentId, name: finalName, data });
	return { id: Number(uploaded?.id ?? 0), path: [...folders, finalName].join('/'), created: true };
}
