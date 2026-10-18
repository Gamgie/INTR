// Plan de rangement du dossier kDrive d'intermittence.
//
//   <dossier>/<année en cours ou à venir>/<MM>/<Employeur>/[BP] AAAA-MM-JJ Employeur.pdf
//   <dossier>/Archive/<année passée>/<MM>/<Employeur>/[CT] AAAA-MM-JJ Employeur.pdf
// Codes : [BP] bulletin de paie, [AEM], [CS] Congés Spectacles, [CT] contrat de travail,
// [ARE] notification France Travail, [GUSO], [DOC] autre document.
//
// « Année » = année d'intermittence (date anniversaire). Un mois de l'année civile précédente
// (fin novembre, décembre) prend le nom « 12 (2025) » pour ne pas se mêler au même mois de
// l'année civile suivante dans le même dossier.
//
// Date, employeur et type viennent de l'analyse faite à l'import ; à défaut, d'une date lue dans
// le nom ou le chemin du fichier. Un fichier sans date reconnue reste où il est.

import type { AppData, DocumentKind } from '$lib/types';
import { currentIntermittenceYear, yearOfDate } from '$lib/years';

export const ARCHIVE_FOLDER = 'Archive';
/** Dossiers de premier niveau jamais touchés par le rangement. */
export const UNTOUCHED_GROUPS = ['Ressource', 'Ressources'];

export type OrganizeSource = {
	id: number;
	name: string;
	path: string;
	group: string;
	parentId: number;
	importable: boolean;
};

export type OrganizeMove = {
	fileId: number;
	fromPath: string;
	fromParentId: number;
	fromName: string;
	/** Dossiers à créer ou retrouver sous le dossier source, dans l'ordre. */
	toDirs: string[];
	toName: string;
	toPath: string;
	date: string;
	employer: string;
	type: string;
	/** D'où vient la date : analyse de l'import ou nom du fichier. */
	basis: 'analyse' | 'nom du fichier';
};

export type OrganizeSkip = { fileId: number; path: string; reason: string };

export type OrganizePlan = {
	moves: OrganizeMove[];
	unchanged: number;
	skipped: OrganizeSkip[];
	currentYear: number;
};

/** Code en tête du nom de fichier : « [BP] 2026-07-26 Compagnie Gamgie.pdf ». */
const TYPE_LABELS: Record<DocumentKind, string> = {
	Contrat: 'CT',
	'Fiche de paie': 'BP',
	AEM: 'AEM',
	'Congé Spectacle': 'CS',
	'Déclaration Guso': 'GUSO',
	'Notification ARE': 'ARE',
	Autre: 'DOC'
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Code lisible dans un nom non analysé : [AEM], [CTT], [CT], [BP], [CS], « Bulletin de paie »… */
function typeFromName(name: string) {
	const lower = name.toLowerCase();
	if (/\[aem\]|\baem\b/.test(lower)) return 'AEM';
	if (/\[ctt?\]|contrat/.test(lower)) return 'CT';
	if (/\[bp\]|bulletin|paie/.test(lower)) return 'BP';
	if (/\[cs\]|cong[eé]s? spectacle/.test(lower)) return 'CS';
	if (/\[are\]|notification/.test(lower)) return 'ARE';
	if (/guso/.test(lower)) return 'GUSO';
	return 'DOC';
}

/** Retire les caractères interdits dans un nom kDrive et les espaces superflus. */
export function cleanName(value: string) {
	return value
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

function extension(name: string) {
	const match = /\.[a-z0-9]{2,5}$/i.exec(name);
	return match ? match[0].toLowerCase() : '';
}

function validDate(year: number, month: number, day = 1) {
	if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return '';
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Première date lisible dans un nom ou un chemin : 2024_10_24, 2024-10-21, 05.2022, 2024/10/… */
export function dateFromText(text: string) {
	const full = /(20\d{2})[_\-. ](\d{2})[_\-. ](\d{2})/.exec(text);
	if (full) {
		const date = validDate(Number(full[1]), Number(full[2]), Number(full[3]));
		if (date) return date;
	}
	const frenchFull = /(\d{2})[_\-./](\d{2})[_\-./](20\d{2})/.exec(text);
	if (frenchFull) {
		const date = validDate(Number(frenchFull[3]), Number(frenchFull[2]), Number(frenchFull[1]));
		if (date) return date;
	}
	const monthYear = /(?:^|[^\d])(\d{2})[._\-](20\d{2})(?:[^\d]|$)/.exec(text);
	if (monthYear) {
		const date = validDate(Number(monthYear[2]), Number(monthYear[1]));
		if (date) return date;
	}
	const pathYearMonth = /(?:^|\/)(20\d{2})\/(\d{2})(?:\/|$)/.exec(text);
	if (pathYearMonth) {
		const date = validDate(Number(pathYearMonth[1]), Number(pathYearMonth[2]));
		if (date) return date;
	}
	return '';
}

/** Vrai si le texte contient une date complète (avec le jour), pas seulement un mois. */
function hasFullDate(text: string) {
	return /(20\d{2})[_\-. ](\d{2})[_\-. ](\d{2})/.test(text) || /(\d{2})[_\-./](\d{2})[_\-./](20\d{2})/.test(text);
}

/** Employeur déduit du chemin quand l'analyse n'en donne pas (…/AAAA/MM/Employeur/fichier). */
function employerFromPath(path: string) {
	const parts = path.split('/');
	const index = parts.findIndex((part, position) => /^\d{2}$/.test(part) && /^20\d{2}$/.test(parts[position - 1] ?? ''));
	const candidate = index >= 0 ? parts[index + 1] : '';
	return candidate && candidate !== parts.at(-1) ? candidate : '';
}

function normalizeWords(value: string) {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.split(' ')
		.filter((word) => word.length >= 4 && !['compagnie', 'production', 'productions', 'association', 'theatre', 'societe'].includes(word));
}

/** Employeur lisible dans un nom de fichier : Zeendoc, « [AEM] 2024-11-09 Baron Production », … */
export function employerFromName(name: string) {
	const stem = name.replace(/\.[a-z0-9]{2,5}$/i, '');
	const zeendoc = /^(?:bulletin de paie|contrat de travail|attestation[^_]*)_(.+?)_\d{4}_/i.exec(stem);
	if (zeendoc) return zeendoc[1].trim();
	const bracket = /^\[[^\]]+\]\s*\d{4}-\d{2}-\d{2}\s+(.+)$/.exec(stem);
	if (bracket) return bracket[1].trim();
	return '';
}

function employerFromText(text: string) {
	const match = /employeur\s*:?\s*([^\n]{2,60})/i.exec(text);
	return match ? match[1].replace(/\s+(siret|urssaf|adresse).*$/i, '').trim() : '';
}

/** Ramène un nom approximatif à une structure connue (« GAMGIE (COMPAGNIE) » → « Compagnie Gamgie »). */
function canonicalEmployer(data: AppData, candidate: string) {
	const words = normalizeWords(candidate);
	if (!words.length) return '';
	const squashed = candidate.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
	for (const company of data.companies) {
		const companyWords = normalizeWords(`${company.name} ${company.legalName}`);
		if (companyWords.some((word) => words.includes(word) || squashed.includes(word))) return company.name;
	}
	return '';
}

/**
 * Premier candidat qui correspond à une structure connue ; sinon une structure connue citée dans
 * le nom du fichier ; sinon le premier candidat tel quel.
 */
function chooseEmployer(data: AppData, candidates: string[], fileName = '') {
	const present = candidates.map((value) => value.trim()).filter(Boolean);
	for (const candidate of present) {
		const known = canonicalEmployer(data, candidate);
		if (known) return known;
	}
	return canonicalEmployer(data, fileName.replace(/\.[a-z0-9]{2,5}$/i, '')) || present[0] || '';
}

type Classification = {
	date: string;
	employer: string;
	type: string;
	basis: OrganizeMove['basis'];
	/** Faux quand seul le mois est connu (nom « 05.2022 », dossier « 2024/06 »). */
	dayKnown?: boolean;
};

function classify(data: AppData, file: OrganizeSource): Classification | undefined {
	const record = data.kdriveImports.find((item) => item.fileId === file.id && item.status === 'importé');
	const companyName = (id: string) => data.companies.find((company) => company.id === id)?.name ?? '';
	const candidates: Classification[] = [];

	for (const documentId of record?.documentIds ?? []) {
		const document = data.documents.find((item) => item.id === documentId);
		if (!document) continue;
		const contract = data.contracts.find((item) => item.id === document.contractId);
		const date = [contract?.startDate, document.extractedFields?.startDate].find(
			(value): value is string => Boolean(value && ISO.test(value))
		);
		if (!date) continue;
		candidates.push({
			date,
			employer: chooseEmployer(data, [
				companyName(contract?.companyId ?? '') || companyName(document.extractedFields?.companyId ?? ''),
				employerFromName(file.name),
				employerFromText(document.extractedTextPreview ?? ''),
				employerFromPath(file.path)
			], file.name),
			type: TYPE_LABELS[document.kind] ?? 'DOC',
			basis: 'analyse'
		});
	}

	for (const periodId of record?.periodIds ?? []) {
		const period = data.periods.find((item) => item.id === periodId);
		const date = [period?.admissionDate, period?.indemnizationStartDate, period?.anniversaryDate].find(
			(value): value is string => Boolean(value && ISO.test(value))
		);
		if (date) candidates.push({ date, employer: 'France Travail', type: 'ARE', basis: 'analyse' });
	}

	if (candidates.length) {
		// Un PDF découpé en plusieurs documents : on garde le premier dans le temps.
		return [...candidates].sort((a, b) => a.date.localeCompare(b.date))[0];
	}

	const fromName = dateFromText(file.name);
	const date = fromName || dateFromText(file.path);
	if (!date) return undefined;
	return {
		date,
		dayKnown: Boolean(fromName) && hasFullDate(file.name),
		employer: chooseEmployer(data, [employerFromName(file.name), employerFromPath(file.path)], file.name),
		type: typeFromName(file.name),
		basis: 'nom du fichier'
	};
}

export function buildOrganizePlan(
	data: AppData,
	files: OrganizeSource[],
	today = new Date()
): OrganizePlan {
	const currentYear = currentIntermittenceYear(data, today).year;
	const moves: OrganizeMove[] = [];
	const skipped: OrganizeSkip[] = [];
	const taken = new Set<string>();
	let unchanged = 0;

	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'fr', { numeric: true }));
	const planned: Array<{ file: OrganizeSource; found: Classification; toDirs: string[]; base: string; ext: string }> = [];

	for (const file of sorted) {
		if (UNTOUCHED_GROUPS.includes(file.group)) {
			skipped.push({ fileId: file.id, path: file.path, reason: `dossier ${file.group} laissé tel quel` });
			continue;
		}
		if (!file.importable) {
			skipped.push({ fileId: file.id, path: file.path, reason: 'format non analysé' });
			continue;
		}
		const found = classify(data, file);
		if (!found) {
			skipped.push({ fileId: file.id, path: file.path, reason: 'aucune date trouvée (importe-le d’abord)' });
			continue;
		}

		const year = yearOfDate(data, found.date)!;
		const [calendarYear, month] = found.date.split('-');
		const monthFolder = Number(calendarYear) === year ? month : `${month} (${calendarYear})`;
		const employer = cleanName(found.employer) || 'Sans employeur';
		planned.push({
			file,
			found: { ...found, employer },
			toDirs: [...(year < currentYear ? [ARCHIVE_FOLDER] : []), String(year), monthFolder, employer],
			base: cleanName(`[${found.type}] ${found.dayKnown === false ? found.date.slice(0, 7) : found.date} ${employer}`),
			ext: extension(file.name) || '.pdf'
		});
	}

	const key = (dirs: string[], name: string) => `${dirs.join('/')}/${name}`.toLowerCase();
	const names = new Map<number, string>();

	// 1. Un fichier qui porte déjà son nom de base au bon endroit le garde.
	for (const item of planned) {
		const name = `${item.base}${item.ext}`;
		if (item.file.path.toLowerCase() === key(item.toDirs, name) && !taken.has(key(item.toDirs, name))) {
			taken.add(key(item.toDirs, name));
			names.set(item.file.id, name);
		}
	}
	// 2. Les autres prennent le premier nom libre : « … 05.2022.pdf », « … 05.2022 2.pdf »…
	for (const item of planned) {
		if (names.has(item.file.id)) continue;
		let name = `${item.base}${item.ext}`;
		for (let index = 2; taken.has(key(item.toDirs, name)); index += 1) name = `${item.base} ${index}${item.ext}`;
		taken.add(key(item.toDirs, name));
		names.set(item.file.id, name);
	}

	for (const item of planned) {
		const toName = names.get(item.file.id)!;
		const toPath = `${item.toDirs.join('/')}/${toName}`;
		if (toPath === item.file.path) {
			unchanged += 1;
			continue;
		}
		moves.push({
			fileId: item.file.id,
			fromPath: item.file.path,
			fromParentId: item.file.parentId,
			fromName: item.file.name,
			toDirs: item.toDirs,
			toName,
			toPath,
			date: item.found.date,
			employer: item.found.employer,
			type: item.found.type,
			basis: item.found.basis
		});
	}

	return { moves, unchanged, skipped, currentYear };
}
