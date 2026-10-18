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
import {
	buildEmployerDirectory,
	employerName,
	readEmployer,
	readHeaderMonth,
	readPeriodStart,
	type EmployerDirectory,
	type EmployerReading
} from '$lib/employer';

type EmployerSource = EmployerReading['format'];
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
	/** Comment l'employeur a été vérifié dans le document. */
	employerSource: EmployerSource;
	type: string;
	/** D'où vient la date : analyse de l'import ou nom du fichier. */
	basis: 'analyse' | 'nom du fichier';
};

export type OrganizeSkip = { fileId: number; path: string; reason: string };

export type OrganizeEmployer = {
	siren: string;
	/** Nom utilisé pour les dossiers et les fichiers. */
	name: string;
	/** Nom tel que lu dans les documents, avant correction. */
	readName: string;
	files: number;
	corrected: boolean;
};

export type OrganizePlan = {
	moves: OrganizeMove[];
	unchanged: number;
	skipped: OrganizeSkip[];
	currentYear: number;
	/** Employeurs trouvés, pour corriger un nom une fois pour tous ses fichiers. */
	employers: OrganizeEmployer[];
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

export type TextDate = { date: string; dayKnown: boolean };

/**
 * Date lisible dans un nom ou un chemin, seulement pour un fichier non analysé (un fichier
 * analysé prend toujours la date de début de son contrat).
 *
 * Noms Zeendoc (« Bulletin de paie_GAMGIE (COMPAGNIE)_2024_10_24_…_2024-10-21 ») : le bloc
 * AAAA_MM_AA donne le mois (le dernier nombre est l'année sur deux chiffres, pas un jour) et la
 * date finale est celle du dépôt du document, pas celle du contrat. On n'en garde que le mois.
 */
export function parseTextDate(text: string): TextDate | undefined {
	const zeendoc = /(20(\d{2}))_(\d{2})_(\d{2})(?:_|$)/.exec(text);
	if (zeendoc && zeendoc[4] === zeendoc[2]) {
		const date = validDate(Number(zeendoc[1]), Number(zeendoc[3]));
		if (date) return { date, dayKnown: false };
	}
	const full = /(20\d{2})[_\-. ](\d{2})[_\-. ](\d{2})/.exec(text);
	if (full) {
		const date = validDate(Number(full[1]), Number(full[2]), Number(full[3]));
		if (date) return { date, dayKnown: true };
	}
	const frenchFull = /(\d{2})[_\-./](\d{2})[_\-./](20\d{2})/.exec(text);
	if (frenchFull) {
		const date = validDate(Number(frenchFull[3]), Number(frenchFull[2]), Number(frenchFull[1]));
		if (date) return { date, dayKnown: true };
	}
	const monthYear = /(?:^|[^\d])(\d{2})[._\-](20\d{2})(?:[^\d]|$)/.exec(text);
	if (monthYear) {
		const date = validDate(Number(monthYear[2]), Number(monthYear[1]));
		if (date) return { date, dayKnown: false };
	}
	const pathYearMonth = /(?:^|\/)(20\d{2})\/(\d{2})(?:\/|$)/.exec(text);
	if (pathYearMonth) {
		const date = validDate(Number(pathYearMonth[1]), Number(pathYearMonth[2]));
		if (date) return { date, dayKnown: false };
	}
	return undefined;
}

/** Date seule (AAAA-MM-JJ, jour 01 quand seul le mois est connu). */
export function dateFromText(text: string) {
	return parseTextDate(text)?.date ?? '';
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

type Classification = {
	date: string;
	employer: string;
	employerSource: EmployerSource;
	siren?: string;
	type: string;
	basis: OrganizeMove['basis'];
	/** Faux quand seul le mois est connu (nom « 05.2022 », dossier « 2024/06 »). */
	dayKnown?: boolean;
};


function baseName(found: Pick<Classification, 'type' | 'date' | 'dayKnown' | 'employer'>) {
	const date = found.dayKnown === false ? found.date.slice(0, 7) : found.date;
	return cleanName(`[${found.type}] ${date} ${cleanName(found.employer) || 'Sans employeur'}`);
}

const CODE_ORDER = ['CT', 'BP', 'AEM', 'CS', 'GUSO', 'ARE', 'DOC'];

function classify(
	data: AppData,
	file: OrganizeSource,
	directory: EmployerDirectory,
	readings: Map<string, EmployerReading | undefined>
): Classification | { skip: string } {
	const record = data.kdriveImports.find((item) => item.fileId === file.id && item.status === 'importé');
	if (!record) {
		return { skip: 'pas encore importé : l’employeur doit être lu dans le document' };
	}

	const contractDates: string[] = [];
	const linkedDates: string[] = [];
	const periodDates: string[] = [];
	const monthOnly = new Set<string>();
	const codes = new Set<string>();
	let employer = '';
	let employerSource: EmployerSource = 'siret seul';
	let siren = '';

	for (const documentId of record.documentIds) {
		const document = data.documents.find((item) => item.id === documentId);
		if (!document) continue;
		// Date du contrat (jamais celle de la paie), par ordre de confiance :
		//   1. début de contrat lu dans l'AEM ou le contrat ;
		//   2. contrat rattaché par l'import, si la période payée tombe bien dans ce contrat ;
		//   3. période lue dans le bulletin ou le certificat de congés (rattachement manifestement faux).
		const text = document.extractedTextPreview ?? '';
		const contract = data.contracts.find((item) => item.id === document.contractId);
		const read = readPeriodStart(text, document.kind);
		const linkedStart = [contract?.startDate, document.extractedFields?.startDate].find(
			(value): value is string => Boolean(value && ISO.test(value))
		);
		const linkedEnd = contract?.endDate && ISO.test(contract.endDate) ? contract.endDate : linkedStart;
		const headerMonth = readHeaderMonth(text);
		if (read?.source === 'contrat') {
			contractDates.push(read.date);
		} else if (read && linkedStart && read.date >= linkedStart && read.date <= (linkedEnd ?? linkedStart)) {
			linkedDates.push(linkedStart);
		} else if (read) {
			periodDates.push(read.date);
		} else if (headerMonth && (!linkedStart || !linkedStart.startsWith(headerMonth))) {
			// Le mois écrit sur le document contredit le contrat rattaché : on garde le mois du document.
			periodDates.push(`${headerMonth}-01`);
			monthOnly.add(`${headerMonth}-01`);
		} else if (linkedStart) {
			linkedDates.push(linkedStart);
		}
		codes.add(TYPE_LABELS[document.kind] ?? 'DOC');
		// Un PDF qui regroupe bulletin, AEM et congés : le premier employeur lisible vaut pour tous.
		const reading = readings.get(document.id);
		const name = employerName(reading, directory);
		if (name && !employer) {
			employer = name;
			employerSource = reading!.format;
			siren = reading!.siren;
		}
	}

	// Une notification ARE ne compte que si le fichier ne contient rien d'autre (l'import prend
	// parfois une page de contrat pour une notification).
	if (!codes.size) {
		for (const periodId of record.periodIds) {
			const period = data.periods.find((item) => item.id === periodId);
			const date = [period?.admissionDate, period?.indemnizationStartDate, period?.anniversaryDate].find(
				(value): value is string => Boolean(value && ISO.test(value))
			);
			if (date) contractDates.push(date);
			codes.add('ARE');
			if (!employer) {
				employer = 'France Travail';
				employerSource = 'contrat';
			}
		}
	}

	const dates = [contractDates, linkedDates, periodDates].find((group) => group.length) ?? [];
	if (!dates.length) return { skip: 'aucune date de contrat trouvée' };
	if (!employer) return { skip: 'employeur introuvable dans le texte du document : à vérifier' };

	const ordered = CODE_ORDER.filter((code) => codes.has(code));
	const date = [...dates].sort()[0];
	return {
		date,
		dayKnown: !monthOnly.has(date),
		employer,
		employerSource,
		siren,
		// Un PDF qui regroupe plusieurs documents porte tous leurs codes : « [BP+AEM+CS] ».
		type: (ordered.length > 1 ? ordered.filter((code) => code !== 'DOC') : ordered).join('+') || 'DOC',
		basis: 'analyse'
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

	// Lecture de l'employeur dans chaque document, puis un nom par SIREN pour tous les documents.
	const readings = new Map(
		data.documents.map((document) => [document.id, readEmployer(document.extractedTextPreview ?? '')])
	);
	const directory = buildEmployerDirectory(
		[...readings.values()].filter((reading): reading is EmployerReading => Boolean(reading)),
		data.settings.employerNames ?? {},
		data.companies
	);
	const rawDirectory = buildEmployerDirectory(
		[...readings.values()].filter((reading): reading is EmployerReading => Boolean(reading))
	);

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
		const found = classify(data, file, directory, readings);
		if ('skip' in found) {
			skipped.push({ fileId: file.id, path: file.path, reason: found.skip });
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
			base: baseName({ ...found, employer }),
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
			employerSource: item.found.employerSource,
			type: item.found.type,
			basis: item.found.basis
		});
	}

	const fileCount = new Map<string, number>();
	for (const item of planned) {
		if (item.found.siren) fileCount.set(item.found.siren, (fileCount.get(item.found.siren) ?? 0) + 1);
	}
	const employers: OrganizeEmployer[] = [...directory.bySiren.entries()]
		.map(([siren, name]) => ({
			siren,
			name,
			readName: rawDirectory.bySiren.get(siren) ?? name,
			files: fileCount.get(siren) ?? 0,
			corrected: Boolean(data.settings.employerNames?.[siren])
		}))
		.filter((employer) => employer.files > 0 || employer.corrected)
		.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

	return { moves, unchanged, skipped, currentYear, employers };
}
