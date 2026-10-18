import { unshift } from '$lib/employer';
import type { Contract, ContractDocument, ContractFields, DocumentKind } from '$lib/types';

// Chiffres lus dans le texte d'un document, par format connu (GHS sPAIEctacle, AEM GHS,
// bulletins Lit Up). Sert à recalculer un contrat à partir de tous ses documents, le bulletin
// d'abord : c'est lui qui dit ce qui a été payé.

export const HOURS_PER_CACHET = 12;

export type Figures = {
	format: string;
	startDate?: string;
	endDate?: string;
	hours?: number;
	cachets?: number;
	days?: number;
	grossSalary?: number;
	netSalary?: number;
	netSocial?: number;
	allowances?: number;
};

const money = String.raw`(\d{1,3}(?:[  ]\d{3})*,\d{2})`;
const toNumber = (value: string | undefined) =>
	value === undefined ? undefined : Number(value.replace(/[  ]/g, '').replace(',', '.'));

function isoDate(day: string, month: string, year: string) {
	const fullYear = year.length === 2 ? `20${year}` : year;
	return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function first(text: string, pattern: RegExp) {
	return toNumber(text.match(pattern)?.[1]);
}

function isGhsPayslip(text: string) {
	return /bulletin de paie/i.test(text) && /sPAIEctacle|GHS|Net payé Cumul Période|BASE Période Cumul/i.test(text);
}

function readGhsPayslip(text: string): Figures {
	const figures: Figures = { format: 'bulletin GHS' };
	const period = text.match(/\bdu (\d{2})\/(\d{2})\/(\d{2,4}) au (\d{2})\/(\d{2})\/(\d{2,4})/i);
	if (period) {
		figures.startDate = isoDate(period[1], period[2], period[3]);
		figures.endDate = isoDate(period[4], period[5], period[6]);
	}

	figures.grossSalary =
		first(text, new RegExp(String.raw`MONTANT BRUT ${money}`, 'i')) ??
		first(text, new RegExp(String.raw`Salaire brut ${money}`, 'i'));
	figures.netSocial = first(text, new RegExp(String.raw`MONTANT NET SOCIAL ${money}`, 'i'));
	// Le net payé (virement), comme dans le classeur de Clément : après impôt à la source.
	figures.netSalary =
		first(text, new RegExp(String.raw`${money} ?€ ?Total versé`, 'i')) ??
		first(text, new RegExp(String.raw`Net payé ${money} ?€`, 'i')) ??
		first(text, new RegExp(String.raw`NET A PAYER AVANT IMPOT SUR LE REVENU ${money}`, 'i')) ??
		figures.netSocial;
	// Les défraiements (repas) sont versés avec le salaire mais ne comptent pas : on les retire du
	// net payé. « 2 Défraiement repas 20,7 20,70 41,40 » : nombre × montant unitaire.
	let allowances = 0;
	for (const match of text.matchAll(/(?:^|[^\d,])(\d{1,2}) (?:Défraiements?|Indem\.?|Indemnités?) repas\b[^\d]{0,20}(\d{1,3},\d{1,2})/gi)) {
		allowances += Number(match[1]) * Number(match[2].replace(',', '.'));
	}
	if (allowances && figures.netSalary !== undefined && figures.netSalary !== figures.netSocial) {
		figures.netSalary = Number((figures.netSalary - allowances).toFixed(2));
		figures.allowances = Number(allowances.toFixed(2));
	}

	// Récapitulatif « BASE » : la première valeur est celle de la période, la seconde le cumul.
	const baseHours = first(text, new RegExp(String.raw`\bBASE\b[\s\S]{0,80}?\bHeures (\d+,\d{2})`, 'i'));
	const baseCachets = first(text, new RegExp(String.raw`\bBASE\b[\s\S]{0,80}?\bCachets (\d+,\d{2})`, 'i'));
	const baseDays = first(text, new RegExp(String.raw`\bBASE\b[\s\S]{0,120}?\bJours (\d+,\d{2})`, 'i'));

	// Lignes de paie : « 3 Cachet(s) », « 6 Cachet de représentation », « 4 Journée(s) de 6 heures ».
	let itemCachets = 0;
	for (const match of text.matchAll(/(?:^|[^\d,])(\d{1,2}) Cachet/gi)) itemCachets += Number(match[1]);
	let itemHours = 0;
	for (const match of text.matchAll(/(?:^|[^\d,])(\d{1,3}) (?:Journée\(s\)|Journées?|Services? de répétition) de (\d{1,2}) heures/gi)) {
		itemHours += Number(match[1]) * Number(match[2]);
	}
	for (const match of text.matchAll(/(?:^|[^\d,])(\d{1,3}) Services? de répétition (\d{1,2}) heures/gi)) {
		itemHours += Number(match[1]) * Number(match[2]);
	}

	const cachets = baseCachets || itemCachets || 0;
	if (cachets) figures.cachets = cachets;
	if (baseDays) figures.days = baseDays;

	if (itemHours && cachets) {
		// Journées ou services en heures, plus des cachets à 12 h.
		figures.hours = itemHours + cachets * HOURS_PER_CACHET;
	} else if (baseHours) {
		// Certains employeurs convertissent déjà les cachets en heures dans le récapitulatif
		// (4 cachets, BASE Heures 48), d'autres non (4 journées de 6 h et 3 cachets, BASE Heures 24).
		figures.hours =
			cachets && baseHours < cachets * HOURS_PER_CACHET ? baseHours + cachets * HOURS_PER_CACHET : baseHours;
	} else if (cachets || itemHours) {
		figures.hours = cachets * HOURS_PER_CACHET + itemHours;
	}

	return figures;
}

// AEM GHS : « 24 09 2020 27 09 2020 X 24 3 320,82 320,82 » ; après les dates viennent, dans
// l'ordre du formulaire Unédic, les heures, les cachets et les jours (cases vides omises), puis
// le salaire brut écrit deux fois.
function readGhsAem(text: string): Figures | undefined {
	const match = text.match(
		new RegExp(
			String.raw`(\d{2}) (\d{2}) (\d{4}) (\d{2}) (\d{2}) (\d{4})((?: X)*(?: \d{1,4}){1,3}) ${money} \8`
		)
	);
	if (!match) return undefined;

	const figures: Figures = {
		format: 'AEM GHS',
		startDate: isoDate(match[1], match[2], match[3]),
		endDate: isoDate(match[4], match[5], match[6]),
		grossSalary: toNumber(match[8])
	};
	const counts = match[7].replace(/X/g, ' ').trim().split(/\s+/).map(Number);
	let hours = 0;
	let cachets = 0;
	if (counts.length === 3) {
		[hours, cachets, figures.days] = counts;
	} else if (counts.length === 2) {
		figures.days = counts[1];
		// Deux nombres : heures et jours, ou cachets et jours. Un « taux horaire » de plus de
		// 60 € ne peut être qu'un cachet.
		if ((figures.grossSalary ?? 0) / counts[0] >= 60) cachets = counts[0];
		else hours = counts[0];
	} else {
		return figures;
	}
	if (cachets) figures.cachets = cachets;
	figures.hours = hours + cachets * HOURS_PER_CACHET;
	return figures;
}

// Bulletins Lit Up (2021) : la ligne du mois donne les heures, le plafond, le brut... et se
// termine par les heures puis le net à payer.
function readLitUpPayslip(text: string): Figures | undefined {
	const row = text.match(/ligne cumul\.\s+((?:\d{1,3}(?: \d{3})*,\d{2}\s+){4,})/i)?.[1];
	if (!row) return undefined;
	const values = [...row.matchAll(/\d{1,3}(?: \d{3})*,\d{2}/g)].map((value) => toNumber(value[0]) ?? 0);
	if (values.length < 6) return undefined;

	const figures: Figures = {
		format: 'bulletin Lit Up',
		hours: values[0],
		grossSalary: values[2],
		netSalary: values[values.length - 1]
	};
	const period = text.match(/(\d{2})\/(\d{2})\/(\d{4}) au (\d{2})\/(\d{2})\/(\d{4})/);
	if (period) {
		figures.startDate = isoDate(period[1], period[2], period[3]);
		figures.endDate = isoDate(period[4], period[5], period[6]);
	}
	return figures;
}

export function readFigures(raw: string, kind: DocumentKind): Figures | undefined {
	if (!raw) return undefined;
	// Police décalée (« %XOOHWLQ » pour « Bulletin ») : on remet le texte d'aplomb.
	const text = raw.includes('\u0003') && !/\b(?:du|de|le|la)\b/i.test(raw.slice(0, 400)) ? unshift(raw) : raw;
	if (kind === 'Fiche de paie') {
		if (isGhsPayslip(text)) return readGhsPayslip(text);
		return readLitUpPayslip(text);
	}
	if (kind === 'AEM') return readGhsAem(text);
	return undefined;
}

type Consolidation = {
	fields: Partial<ContractFields>;
	sources: string[];
};

const sum = (values: (number | undefined)[]) =>
	Number(values.reduce<number>((total, value) => total + (value ?? 0), 0).toFixed(2));

function combine(list: Figures[]) {
	// Un même bulletin importé deux fois (copie, découpe) ne compte qu'une fois.
	const unique = new Map<string, Figures>();
	for (const figures of list) {
		unique.set(`${figures.startDate}|${figures.endDate}|${figures.grossSalary}`, figures);
	}
	return [...unique.values()];
}

// Recalcule heures, cachets, brut et net d'un contrat à partir de ses documents :
// heures de l'AEM, montants du bulletin. Les champs qu'aucun document ne permet de lire restent tels quels.
export function consolidateContract(contract: Contract, documents: ContractDocument[]): Consolidation {
	const own = documents.filter((document) => contract.documentIds.includes(document.id));
	const read = (kind: DocumentKind) =>
		combine(
			own
				.filter((document) => document.kind === kind)
				.map((document) => readFigures(document.extractedTextPreview, document.kind))
				.filter((figures): figures is Figures => Boolean(figures))
		);
	const payslips = read('Fiche de paie');
	const aems = read('AEM');
	const fields: Partial<ContractFields> = {};
	const sources: string[] = [];

	// Heures : celles de l'AEM, c'est ce que l'employeur déclare à France Travail (heures plus
	// cachets à 12 h) ; le récapitulatif du bulletin compte parfois les cachets autrement.
	// Seulement si chaque bulletin a son AEM : sinon une AEM manquante ferait perdre des heures.
	const aemsCoverPayslips = aems.filter((figures) => figures.hours).length >= payslips.length;
	const hourSource = aemsCoverPayslips && aems.some((figures) => figures.hours)
		? aems
		: payslips.some((figures) => figures.hours)
			? payslips
			: [];
	if (hourSource.length) {
		fields.hours = sum(hourSource.map((figures) => figures.hours));
		fields.cachets = sum(hourSource.map((figures) => figures.cachets));
		sources.push(`heures : ${hourSource[0].format}`);
	}

	const grossSource = payslips.some((figures) => figures.grossSalary) ? payslips : aems;
	if (grossSource.some((figures) => figures.grossSalary)) {
		fields.grossSalary = sum(grossSource.map((figures) => figures.grossSalary));
		sources.push(`brut : ${grossSource[0].format}`);
	}

	if (payslips.some((figures) => figures.netSalary)) {
		fields.netSalary = sum(payslips.map((figures) => figures.netSalary));
		sources.push('net payé : bulletin');
	}

	// Dates du contrat : celles de l'AEM (début et fin du contrat de travail), sinon celles des
	// bulletins. Un contrat payé sur deux mois a deux bulletins et une seule période.
	const dated = (aems.some((figures) => figures.startDate) ? aems : payslips).filter(
		(figures) => figures.startDate && figures.endDate
	);
	if (dated.length) {
		fields.startDate = dated.map((figures) => figures.startDate!).sort()[0];
		fields.endDate = dated.map((figures) => figures.endDate!).sort().at(-1);
		sources.push(`dates : ${dated[0].format}`);
	}

	if (fields.hours && fields.grossSalary) {
		fields.grossHourlyRate = Number((fields.grossSalary / fields.hours).toFixed(2));
	}
	const net = fields.netSalary ?? contract.netSalary;
	const hours = fields.hours ?? contract.hours;
	if (net && hours) fields.netHourlyRate = Number((net / hours).toFixed(2));

	// Ne garder que ce qui change.
	for (const key of Object.keys(fields) as (keyof ContractFields)[]) {
		if (contract[key] === fields[key]) delete fields[key];
	}
	return { fields, sources };
}
