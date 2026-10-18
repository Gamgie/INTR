// Années d'intermittence : chaque année court du lendemain d'une date anniversaire jusqu'à la
// suivante. L'année porte le numéro de l'année civile de sa date anniversaire de fin :
// « 2026 » = du 16/11/2025 au 15/11/2026 si les anniversaires sont le 15 novembre.
//
// Date anniversaire d'une année, par ordre de priorité :
//   1. saisie à la main (réglages, onglet Historique)
//   2. lue dans une notification ARE importée
//   3. estimée à partir de l'année connue la plus proche (même jour, même mois)
//   4. à défaut, le 25 novembre (« généralement vers fin novembre »)

import type { AppData, IntermittencePeriod } from '$lib/types';

export const ALL_YEARS = 'all';
export const YEAR_PREFIX = 'year:';
const DEFAULT_MONTH_DAY = '11-25';

export type AnniversarySource = 'saisie' | 'notification' | 'estimée';

export type IntermittenceYear = {
	key: string;
	year: number;
	/** Premier jour de l'année d'intermittence (lendemain de l'anniversaire précédent). */
	start: string;
	/** Date anniversaire qui clôt l'année. */
	end: string;
	source: AnniversarySource;
	isCurrent: boolean;
	isFuture: boolean;
	/** Notification ARE dont l'anniversaire tombe dans cette année (droits versés cette année). */
	notification?: IntermittencePeriod;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function toIso(date: Date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parse(iso: string) {
	return new Date(`${iso}T00:00:00`);
}

function addDays(iso: string, days: number) {
	const date = parse(iso);
	date.setDate(date.getDate() + days);
	return toIso(date);
}

function withYear(monthDay: string, year: number) {
	const [month, day] = monthDay.split('-').map(Number);
	// 29 février sur une année non bissextile : on recule au 28.
	const date = new Date(year, month - 1, day);
	if (date.getMonth() !== month - 1) date.setDate(0);
	return toIso(date);
}

type Known = { year: number; date: string; source: AnniversarySource; notification?: IntermittencePeriod };

function knownAnniversaries(data: AppData) {
	const known = new Map<number, Known>();

	for (const period of data.periods ?? []) {
		if (!ISO.test(period.anniversaryDate)) continue;
		const year = Number(period.anniversaryDate.slice(0, 4));
		const existing = known.get(year);
		if (!existing || period.anniversaryDate > existing.date) {
			known.set(year, { year, date: period.anniversaryDate, source: 'notification', notification: period });
		}
	}

	// Le début de la période de référence d'une notification suit la date anniversaire de
	// l'année précédente (référence du 03/12/2022 au 30/11/2023 : année 2022 close le 02/12/2022).
	for (const period of data.periods ?? []) {
		if (!ISO.test(period.referenceStartDate)) continue;
		const date = addDays(period.referenceStartDate, -1);
		const year = Number(date.slice(0, 4));
		if (!known.has(year)) known.set(year, { year, date, source: 'notification' });
	}

	for (const [yearText, date] of Object.entries(data.settings.anniversaries ?? {})) {
		const year = Number(yearText);
		if (!Number.isInteger(year) || !ISO.test(date)) continue;
		known.set(year, { ...known.get(year), year, date, source: 'saisie' });
	}

	return known;
}

/** Date anniversaire qui clôt l'année `year`. */
export function anniversaryFor(data: AppData, year: number, known = knownAnniversaries(data)): Known {
	const exact = known.get(year);
	if (exact) return exact;

	let nearest: Known | undefined;
	for (const candidate of known.values()) {
		if (!nearest || Math.abs(candidate.year - year) < Math.abs(nearest.year - year)) nearest = candidate;
	}
	const monthDay = nearest ? nearest.date.slice(5) : DEFAULT_MONTH_DAY;
	return { year, date: withYear(monthDay, year), source: 'estimée' };
}

/** Numéro de l'année d'intermittence qui contient la date `iso` (AAAA-MM-JJ). */
export function yearOfDate(data: AppData, iso: string, known = knownAnniversaries(data)) {
	if (!ISO.test(iso)) return undefined;
	const year = Number(iso.slice(0, 4));
	return iso > anniversaryFor(data, year, known).date ? year + 1 : year;
}

function buildYear(data: AppData, year: number, today: string, known: Map<number, Known>): IntermittenceYear {
	const anniversary = anniversaryFor(data, year, known);
	const start = addDays(anniversaryFor(data, year - 1, known).date, 1);
	const notification =
		anniversary.notification ??
		(data.periods ?? []).find(
			(period) => period.anniversaryDate >= start && period.anniversaryDate <= anniversary.date
		);

	return {
		key: `${YEAR_PREFIX}${year}`,
		year,
		start,
		end: anniversary.date,
		source: anniversary.source,
		isCurrent: today >= start && today <= anniversary.date,
		isFuture: today < start,
		notification
	};
}

/** Toutes les années qui contiennent un contrat, un mois saisi ou une notification, plus l'année en cours. */
export function intermittenceYears(data: AppData, todayDate = new Date()): IntermittenceYear[] {
	const known = knownAnniversaries(data);
	const today = toIso(todayDate);
	const years = new Set<number>([yearOfDate(data, today, known)!]);

	for (const contract of data.contracts) {
		const year = yearOfDate(data, contract.startDate, known);
		if (year) years.add(year);
	}
	for (const info of data.monthlyInfos) {
		const year = yearOfDate(data, `${info.month}-15`, known);
		if (year && (info.realIndemnity || info.congeSpectacle)) years.add(year);
	}
	for (const period of data.periods ?? []) {
		const year = yearOfDate(data, period.anniversaryDate, known);
		if (year) years.add(year);
	}

	return [...years]
		.sort((a, b) => b - a)
		.map((year) => buildYear(data, year, today, known));
}

export function currentIntermittenceYear(data: AppData, todayDate = new Date()) {
	const known = knownAnniversaries(data);
	const today = toIso(todayDate);
	return buildYear(data, yearOfDate(data, today, known)!, today, known);
}

/**
 * Année choisie dans l'app : `activePeriodId` vide = année en cours, `year:2025` = cette année,
 * `all` = toutes les années (renvoie undefined).
 */
export function selectedIntermittenceYear(data: AppData, todayDate = new Date()) {
	const id = data.settings.activePeriodId;
	if (id === ALL_YEARS) return undefined;
	if (id.startsWith(YEAR_PREFIX)) {
		const year = Number(id.slice(YEAR_PREFIX.length));
		if (Number.isInteger(year)) {
			const known = knownAnniversaries(data);
			return buildYear(data, year, toIso(todayDate), known);
		}
	}
	return currentIntermittenceYear(data, todayDate);
}

/** Période utilisée par les calculs pour une année : bornes de l'année, AJ de sa notification. */
export function yearAsPeriod(year: IntermittenceYear): IntermittencePeriod {
	const notification = year.notification;
	return {
		id: year.key,
		label: `Année ${year.year}`,
		status: notification?.status ?? 'Estimation',
		admissionDate: notification?.admissionDate ?? '',
		indemnizationStartDate: year.start,
		anniversaryDate: year.end,
		referenceStartDate: year.start,
		referenceEndDate: year.end,
		hours: notification?.hours ?? 0,
		cachets: notification?.cachets ?? 0,
		grossSalary: notification?.grossSalary ?? 0,
		dailyAllowance: notification?.dailyAllowance ?? 0,
		waitingDays: notification?.waitingDays ?? 0,
		salaryFranchiseDays: notification?.salaryFranchiseDays ?? 0,
		congeFranchiseDays: notification?.congeFranchiseDays ?? 0,
		sourceFileName: '',
		sourceStoredName: '',
		sourceTextPreview: '',
		analysisNotes: [],
		createdAt: '',
		updatedAt: '',
		notes: ''
	};
}

export function yearLabel(year: IntermittenceYear) {
	const format = (iso: string) => iso.split('-').reverse().join('/');
	return `${year.year} · du ${format(year.start)} au ${format(year.end)}`;
}
