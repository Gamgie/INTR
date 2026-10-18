import {
	PDFCheckBox,
	PDFDocument,
	PDFDropdown,
	PDFOptionList,
	PDFRadioGroup,
	PDFTextField
} from 'pdf-lib';
import type { PDFField } from 'pdf-lib';

import type { ContractFields, DocumentKind } from '$lib/types';
import { frenchDatePattern, normalizeDateText, parseFrenchDate } from '$lib/date';

export type DocumentAnalysis = {
	textPreview: string;
	fields: Partial<ContractFields>;
	notes: string[];
};

export type PdfTextExtraction = {
	pages: string[];
	text: string;
	ocrPageNumbers: number[];
	ocrAttemptedPageNumbers: number[];
	ocrSkippedPageNumbers: number[];
	ocrFailed: boolean;
};

const moneyPattern = String.raw`([0-9]{1,3}(?:[\s.][0-9]{3})*(?:[,.][0-9]{1,2})?|[0-9]+(?:[,.][0-9]{1,2})?)(?!\d)`;
const numberPattern = String.raw`([0-9]+(?:[,.][0-9]+)?)`;
const minimumNativePageCharacters = 32;
const maximumOcrPages = 20;

function toNumber(value: string | undefined) {
	if (!value) return undefined;
	const normalized = value.replace(/\s/g, '').replace(',', '.');
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeText(text: string) {
	return text
		.replace(/\u0000/g, '')
		.replace(/\r/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function cleanPdfFieldValue(value: string | undefined) {
	const cleaned = String(value ?? '').trim();
	return cleaned && cleaned.toLowerCase() !== 'undefined' ? cleaned : '';
}

function pdfFieldValue(field: PDFField) {
	if (field instanceof PDFTextField) return cleanPdfFieldValue(field.getText());
	if (field instanceof PDFCheckBox) return field.isChecked() ? 'true' : '';
	if (field instanceof PDFRadioGroup) return cleanPdfFieldValue(field.getSelected());
	if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
		return field.getSelected().map(cleanPdfFieldValue).filter(Boolean).join(', ');
	}

	return '';
}

async function extractPdfFormText(buffer: Buffer) {
	try {
		const document = await PDFDocument.load(buffer, { ignoreEncryption: true });
		const fields = document.getForm().getFields();
		const lines = fields
			.map((field) => {
				const value = pdfFieldValue(field);
				return value ? `PDF_FIELD ${field.getName()}: ${value}` : '';
			})
			.filter(Boolean);

		return normalizeText(lines.join('\n'));
	} catch {
		return '';
	}
}

export function extractPdfTextFromBuffer(buffer: Buffer) {
	const raw = buffer.toString('latin1');
	const strings: string[] = [];
	const literalPattern = /\(([^()]{2,})\)/g;
	const hexPattern = /<([0-9A-Fa-f\s]{8,})>/g;

	for (const match of raw.matchAll(literalPattern)) {
		strings.push(match[1].replace(/\\([()\\])/g, '$1'));
	}

	for (const match of raw.matchAll(hexPattern)) {
		const hex = match[1].replace(/\s/g, '');
		if (hex.length % 2 !== 0) continue;
		const bytes = hex.match(/.{2}/g)?.map((part: string) => Number.parseInt(part, 16)) ?? [];
		const printable = Buffer.from(bytes)
			.toString('utf16le')
			.replace(/[^\S\n]+/g, ' ');
		if (/[A-Za-z0-9]{3}/.test(printable)) strings.push(printable);
	}

	return normalizeText(strings.join('\n'));
}

function usefulTextLength(text: string) {
	return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

export async function extractPdfDocumentText(buffer: Buffer): Promise<PdfTextExtraction> {
	const formText = await extractPdfFormText(buffer);

	try {
		const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
		const document = await pdfjs.getDocument({
			data: Uint8Array.from(buffer),
			disableFontFace: true,
			useSystemFonts: true
		}).promise;

		try {
			const nativePages: string[] = [];

			for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
				const page = await document.getPage(pageNumber);
				const content = await page.getTextContent();
				const text = content.items
					.map((item) => ('str' in item ? item.str : ''))
					.filter(Boolean)
					.join(' ');
				nativePages.push(normalizeText(text));
				page.cleanup();
			}

			const sparsePageNumbers = nativePages
				.map((text, index) => ({ pageNumber: index + 1, text }))
				.filter(({ text }) => usefulTextLength(text) < minimumNativePageCharacters)
				.map(({ pageNumber }) => pageNumber);
			const ocrAttemptedPageNumbers = sparsePageNumbers.slice(0, maximumOcrPages);
			const ocrSkippedPageNumbers = sparsePageNumbers.slice(maximumOcrPages);
			let ocrPages = new Map<number, string>();
			let ocrFailed = false;

			if (ocrAttemptedPageNumbers.length) {
				try {
					const { recognizePdfPages } = await import('$lib/server/pdfOcr');
					ocrPages = await recognizePdfPages(document, ocrAttemptedPageNumbers);
				} catch (cause) {
					ocrFailed = true;
					console.error('OCR PDF indisponible:', cause);
				}
			}

			const pages = nativePages.map((nativeText, index) => {
				const ocrText = normalizeText(ocrPages.get(index + 1) ?? '');
				return ocrText || nativeText;
			});
			const text = normalizeText([...pages.filter(Boolean), formText].filter(Boolean).join('\n\n'));

			return {
				pages,
				text: text || extractPdfTextFromBuffer(buffer),
				ocrPageNumbers: [...ocrPages.entries()]
					.filter(([, text]) => usefulTextLength(text) > 0)
					.map(([pageNumber]) => pageNumber),
				ocrAttemptedPageNumbers,
				ocrSkippedPageNumbers,
				ocrFailed
			};
		} finally {
			await document.cleanup();
		}
	} catch {
		const text = formText || extractPdfTextFromBuffer(buffer);
		return {
			pages: text ? [text] : [],
			text,
			ocrPageNumbers: [],
			ocrAttemptedPageNumbers: [],
			ocrSkippedPageNumbers: [],
			ocrFailed: false
		};
	}
}

export async function extractPdfPagesText(buffer: Buffer) {
	return (await extractPdfDocumentText(buffer)).pages;
}

export async function extractPdfTextFromBufferAsync(buffer: Buffer) {
	return (await extractPdfDocumentText(buffer)).text;
}

export function classifyDocumentKind(text: string, fallback: DocumentKind) {
	const normalized = normalizeDateText(normalizeText(text));

	if (
		/notification|ouverture de droits|allocation journaliere|france travail/.test(normalized) ||
		(/\bpole emploi\b|\bare\b/.test(normalized) &&
			/allocation|indemnis|demandeur d emploi|ouverture de droits/.test(normalized))
	) {
		return 'Notification ARE' as const;
	}

	if (/attestation employeur mensuelle|\baem\b|employeur mensuel/.test(normalized)) {
		return 'AEM' as const;
	}

	if (
		/\bguso\b|guichet unique pour l emploi|declaration unique et simplifiee|pdf_field\s+cdgus_|pdf_field\s+cdsrt/.test(
			normalized
		)
	) {
		return 'Déclaration Guso' as const;
	}

	if (
		/contrat de travail|contrat d engagement|cdd d usage|engagement d artiste|conditions d engagement/.test(
			normalized
		)
	) {
		return 'Contrat' as const;
	}

	if (/bulletin de (?:paie|salaire)|fiche de paie/.test(normalized)) {
		return 'Fiche de paie' as const;
	}

	if (
		/\b(?:certificat\s+d['’]?emploi\s+les?\s+cong[eé]s?\s+spectacl(?:e|es)|cong[eé]s?\s+spectacl(?:e|es)|caisse\s+des?\s+cong[eé]s?|certificat\s+de\s+cong[eé]s?|attestation\s+de\s+cong[eé]s?\s+spectacl(?:e|es)|indemnit[eé]\s+de\s+cong[eé]s?)\b/.test(
			normalized
		)
	) {
		return 'Congé Spectacle' as const;
	}

	if (/net a payer|net imposable|cotisations salariales/.test(normalized)) {
		return 'Fiche de paie' as const;
	}

	return fallback;
}

export async function extractTextFromBuffer(fileName: string, type: string, buffer: Buffer) {
	const lowerName = fileName.toLowerCase();
	const lowerType = type.toLowerCase();

	if (lowerType.includes('pdf') || lowerName.endsWith('.pdf')) {
		return extractPdfTextFromBufferAsync(buffer);
	}

	if (
		lowerType.startsWith('text/') ||
		lowerName.endsWith('.txt') ||
		lowerName.endsWith('.csv') ||
		lowerName.endsWith('.md')
	) {
		return normalizeText(new TextDecoder('utf-8').decode(buffer));
	}

	return '';
}

export async function extractTextFromFile(file: File, buffer: Buffer) {
	return extractTextFromBuffer(file.name, file.type, buffer);
}

function matchMoney(text: string, labels: string[]) {
	for (const label of labels) {
		const pattern = new RegExp(
			`${label}[\\s\\S]{0,45}?${moneyPattern}\\s*(?:EUR|\\u20ac|euros?)`,
			'i'
		);
		const value = toNumber(text.match(pattern)?.[1]);
		if (value !== undefined) return value;
	}

	return undefined;
}

function matchNumber(text: string, labels: string[]) {
	for (const label of labels) {
		const pattern = new RegExp(`${label}.{0,35}${numberPattern}`, 'i');
		const value = toNumber(text.match(pattern)?.[1]);
		if (value !== undefined) return value;
	}

	return undefined;
}

function matchPayrollCachets(text: string) {
	const payrollPatterns = [
		new RegExp(`${numberPattern}\\s+cachet(?:s|\\(s\\))\\s+isole(?:s|\\(s\\))\\b`, 'i'),
		new RegExp(`${numberPattern}\\s+cachet(?:s|\\(s\\))\\s+groupe(?:s|\\(s\\))\\b`, 'i')
	];

	for (const pattern of payrollPatterns) {
		const value = toNumber(text.match(pattern)?.[1]);
		if (value !== undefined) return value;
	}

	const explicitPatterns = [
		new RegExp(`(?:nombre|nb)\\s+de\\s+cachet(?:s|\\(s\\))\\s*:\\s*${numberPattern}`, 'i'),
		new RegExp(
			`cachet(?:s|\\(s\\))\\s+(?:declares|effectues|retenus)\\s*:\\s*${numberPattern}`,
			'i'
		)
	];

	for (const pattern of explicitPatterns) {
		const value = toNumber(text.match(pattern)?.[1]);
		if (value !== undefined) return value;
	}

	return undefined;
}

function isAemDocument(text: string) {
	return /attestation employeur mensuelle|\baem\b|employeur mensuel/.test(text);
}

function analyzeAem(text: string) {
	const searchable = normalizeDateText(text);
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];

	if (!isAemDocument(searchable)) return { fields, notes };

	const workValues = searchable.match(
		/\b[0-3]?\d\s+[01]?\d\s+\d{4}\s+[0-3]?\d\s+[01]?\d\s+\d{4}\s+(?:x\s+){0,6}([0-9]+(?:[,.][0-9]+)?)\s+([0-9]+(?:[,.][0-9]+)?)(?=\s+[0-9])/i
	);
	const hours = toNumber(workValues?.[1]);
	const days = toNumber(workValues?.[2]);

	if (hours !== undefined && hours > 0 && hours <= 1_000 && days !== undefined && days <= 366) {
		fields.hours = hours;
		notes.push('Heures AEM analysées depuis la zone de prestation de travail.');
	}

	return { fields, notes };
}

function pdfFieldsMap(text: string) {
	const fields = new Map<string, string>();
	const pattern = /^PDF_FIELD\s+([A-Za-z0-9_]+):\s*(.+)$/gm;

	for (const match of text.matchAll(pattern)) {
		const key = match[1].trim().toUpperCase();
		const value = cleanPdfFieldValue(match[2]);
		if (key && value) fields.set(key, value);
	}

	return fields;
}

function fieldValue(fields: Map<string, string>, ...keys: string[]) {
	for (const key of keys) {
		const value = cleanPdfFieldValue(fields.get(key.toUpperCase()));
		if (value) return value;
	}

	return '';
}

function fieldNumber(fields: Map<string, string>, key: string) {
	return toNumber(fieldValue(fields, key));
}

function sumFieldNumbers(fields: Map<string, string>, keys: string[]) {
	const values = keys
		.map((key) => fieldNumber(fields, key))
		.filter((value): value is number => value !== undefined);

	if (!values.length) return undefined;
	return Number(values.reduce((total, value) => total + value, 0).toFixed(2));
}

function fieldMoney(fields: Map<string, string>, integerKey: string, decimalKey: string) {
	const integer = fieldValue(fields, integerKey).replace(/[^\d-]/g, '');
	const decimal = fieldValue(fields, decimalKey).replace(/\D/g, '').padStart(2, '0').slice(0, 2);

	if (!integer && !decimal) return undefined;
	return toNumber(`${integer || '0'},${decimal || '00'}`);
}

function humanizeUpperValue(value: string) {
	const cleaned = value.replace(/\s+/g, ' ').trim().toLowerCase();
	return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : '';
}

function analyzeGusoFields(text: string) {
	const formFields = pdfFieldsMap(text);
	const searchable = normalizeDateText(text);
	const isGuso =
		/\bguso\b|guichet unique pour l emploi|declaration unique et simplifiee/.test(searchable) ||
		formFields.has('CDGUS_E') ||
		formFields.has('CDGUS_S');
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];

	if (!isGuso) return { fields, notes };

	const title = humanizeUpperValue(fieldValue(formFields, 'LZOCT'));
	const startDate = parseFrenchDate(fieldValue(formFields, 'DDPEL', 'DDEMB'));
	const endDate = parseFrenchDate(fieldValue(formFields, 'DFPEL', 'DDPEL', 'DDEMB'));
	const employmentStatus =
		humanizeUpperValue(fieldValue(formFields, 'CSNLC6')) ||
		(formFields.has('CSQCG_T') ? 'Technicien/Ouvrier' : '') ||
		(formFields.has('CSQCG_A') ? 'Artiste' : '');
	const explicitHours = sumFieldNumbers(formFields, ['PSHAR_T', 'PSHAR_A', 'PSHAR_A_REPET']);
	const cachets = sumFieldNumbers(formFields, ['PSCFE', 'PSCFE_REPET']);
	const cachetHours =
		cachets !== undefined && cachets > 0
			? cachets * cachetHoursPerUnit(employmentStatus)
			: undefined;
	const hours = explicitHours ?? cachetHours;
	const grossSalary = fieldMoney(formFields, 'QMBRG_ENT', 'QMBRG_DEC');
	const netSalary =
		fieldMoney(formFields, 'QMSALN_ENT', 'QMSALN_DEC') ??
		fieldMoney(formFields, 'QMSNAPPAS_ENT', 'QMSNAPPAS_DEC');
	const contributions = fieldMoney(formFields, 'QMCDE_ENT', 'QMCDE_DEC');

	if (title) fields.title = `Guso - ${title}`;
	if (startDate) fields.startDate = startDate;
	if (endDate) fields.endDate = endDate;
	if (employmentStatus) fields.employmentStatus = employmentStatus;
	if (hours !== undefined) fields.hours = hours;
	if (cachets !== undefined) fields.cachets = cachets;
	if (grossSalary !== undefined) fields.grossSalary = grossSalary;
	if (netSalary !== undefined) fields.netSalary = netSalary;
	if (contributions !== undefined) fields.contributions = contributions;

	if (cachetHours !== undefined && explicitHours === undefined) {
		notes.push(
			`Cachets Guso convertis en heures (${cachetHoursPerUnit(employmentStatus)} h/cachet, statut ${employmentStatus || 'intermittent'}).`
		);
	}

	if (Object.keys(fields).length) {
		notes.push('Déclaration Guso analysée depuis les champs PDF.');
	}

	return { fields, notes };
}

function matchEmploymentStatus(text: string) {
	const candidates = [
		{ pattern: /\bartiste\s+visuel(?:le)?\b/i, label: 'Artiste visuel' },
		{ pattern: /\bartiste\s+de\s+cirque\b/i, label: 'Artiste de cirque' },
		{ pattern: /\bartiste\s+musicien(?:ne)?\b/i, label: 'Artiste musicien' },
		{ pattern: /\bartiste\s+choregraphique\b/i, label: 'Artiste choregraphique' },
		{ pattern: /\bartiste\s+dramatique\b/i, label: 'Artiste dramatique' },
		{ pattern: /\bartiste\s+interprete\b/i, label: 'Artiste interprete' },
		{ pattern: /\btechnicien\s+video\b/i, label: 'Technicien video' },
		{ pattern: /\btechnicien\s+son\b/i, label: 'Technicien son' },
		{ pattern: /\bregisseur\b/i, label: 'Regisseur' },
		{ pattern: /\btechnicien(?:ne)?\b/i, label: 'Technicien' },
		{ pattern: /\bartiste\b/i, label: 'Artiste' }
	];

	return candidates.find((candidate) => candidate.pattern.test(text))?.label ?? '';
}

function cachetHoursPerUnit(employmentStatus: string) {
	return normalizeDateText(employmentStatus).includes('technicien') ? 8 : 12;
}

function matchDatedWorkHours(text: string) {
	const pattern = new RegExp(
		String.raw`\b${frenchDatePattern}\s*(?:-|:)\s*${numberPattern}\s*h(?:eure)?(?:s|\(s\))?(?=\s|$)`,
		'gi'
	);
	const values = [...text.matchAll(pattern)]
		.map((match) => toNumber(match[1]))
		.filter((value): value is number => value !== undefined);

	if (!values.length) return undefined;
	return Number(values.reduce((total, value) => total + value, 0).toFixed(2));
}

function matchWorkedHours(text: string) {
	const datedWorkHours = matchDatedWorkHours(text);
	if (datedWorkHours !== undefined) return datedWorkHours;

	const summarizedHoursPattern = new RegExp(
		`(?:nombre\\s+de\\s+)?(?:jour(?:s|\\(s\\))?|cachet(?:s|\\(s\\))?)[\\s\\S]{0,80}?\\bsoit\\s+${numberPattern}\\s*h(?:eure)?(?:s|\\(s\\))?\\b`,
		'i'
	);
	const summarizedHours = toNumber(text.match(summarizedHoursPattern)?.[1]);
	if (summarizedHours !== undefined) return summarizedHours;

	const periodBasePattern = new RegExp(
		`(?:cumul\\s+periode\\s+base|base\\s+[^\\n]{0,80}heures)\\s+[^\\n]{0,80}heures\\s+${numberPattern}`,
		'i'
	);
	const periodBaseMatch = text.match(periodBasePattern);
	const periodBaseHours = toNumber(periodBaseMatch?.[1]);
	if (periodBaseHours !== undefined) return periodBaseHours;

	const dayHoursPattern = new RegExp(
		`(?:^|\\b)${numberPattern}\\s*(?:journee\\(s\\)|journees|jours)\\s+(?:de|a)\\s+${numberPattern}\\s*h(?:eures)\\b`,
		'i'
	);
	const dayHoursMatch = text.match(dayHoursPattern);
	if (dayHoursMatch) {
		const days = toNumber(dayHoursMatch[1]);
		const hoursPerDay = toNumber(dayHoursMatch[2]);
		if (days !== undefined && hoursPerDay !== undefined) return days * hoursPerDay;
	}

	const declaredHoursPatterns = [
		new RegExp(
			`(?:heures\\s+(?:declarees|travaillees|effectuees|retenues))\\s*:\\s*${numberPattern}`,
			'i'
		),
		new RegExp(`(?:nombre|nb)\\s+d\\s*heures\\s*:\\s*${numberPattern}`, 'i'),
		new RegExp(
			`${numberPattern}\\s*h(?:eures)\\s+(?:declarees|travaillees|effectuees|retenues)`,
			'i'
		)
	];

	for (const pattern of declaredHoursPatterns) {
		const value = toNumber(text.match(pattern)?.[1]);
		if (value !== undefined) return value;
	}

	return undefined;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+^${}()|[\]\\]/g, '\\$&');
}

function labelPattern(label: string) {
	return escapeRegExp(normalizeDateText(label)).replace(/\s+/g, String.raw`\s+`);
}

function matchDate(text: string, labels: string[]) {
	for (const label of labels) {
		const pattern = new RegExp(`${labelPattern(label)}[\\s\\S]{0,80}(${frenchDatePattern})`, 'i');
		const value = parseFrenchDate(text.match(pattern)?.[1]);
		if (value) return value;
	}

	return undefined;
}

function isoFromNumericParts(day: string, month: string, year: string) {
	const fullYear = Number(year.length === 2 ? `20${year}` : year);
	const monthNumber = Number(month);
	const dayNumber = Number(day);
	const date = new Date(Date.UTC(fullYear, monthNumber - 1, dayNumber));

	if (
		date.getUTCFullYear() !== fullYear ||
		date.getUTCMonth() !== monthNumber - 1 ||
		date.getUTCDate() !== dayNumber
	) {
		return undefined;
	}

	return `${String(fullYear).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-${String(
		dayNumber
	).padStart(2, '0')}`;
}

function isChronologicalPeriod(start: string, end: string) {
	return new Date(`${start}T00:00:00`) <= new Date(`${end}T00:00:00`);
}

function matchExplicitPeriod(text: string) {
	const patterns = [
		new RegExp(String.raw`\bdu\s+(${frenchDatePattern})\s+au\s+(${frenchDatePattern})`, 'i'),
		new RegExp(
			String.raw`\bperiode\s*:\s*(${frenchDatePattern})\s+(?:au|a|-)\s+(${frenchDatePattern})`,
			'i'
		)
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		const startDate = parseFrenchDate(match?.[1]);
		const endDate = parseFrenchDate(match?.[2]);

		if (startDate && endDate && isChronologicalPeriod(startDate, endDate)) {
			return { startDate, endDate };
		}
	}

	return undefined;
}

function matchLabeledWorkPeriod(text: string) {
	const pattern = new RegExp(
		String.raw`\bdates?\s+de\s+travail[\s\S]{0,160}?\bdebut\s+(${frenchDatePattern})[\s\S]{0,80}?\bfin\s+(${frenchDatePattern})`,
		'i'
	);
	const match = text.match(pattern);
	const startDate = parseFrenchDate(match?.[1]);
	const endDate = parseFrenchDate(match?.[2]);

	return startDate && endDate && isChronologicalPeriod(startDate, endDate)
		? { startDate, endDate }
		: undefined;
}

function matchStructuredPeriod(text: string) {
	const pattern = /\b([0-3]?\d)\s+([01]?\d)\s+(\d{4})\s+([0-3]?\d)\s+([01]?\d)\s+(\d{4})\b/g;
	const currentYear = new Date().getFullYear();

	for (const match of text.matchAll(pattern)) {
		const startDate = isoFromNumericParts(match[1], match[2], match[3]);
		const endDate = isoFromNumericParts(match[4], match[5], match[6]);
		const year = Number(match[3]);

		if (
			startDate &&
			endDate &&
			year >= 2020 &&
			year <= currentYear + 2 &&
			isChronologicalPeriod(startDate, endDate)
		) {
			return { startDate, endDate };
		}
	}

	return undefined;
}

function matchFirstMoney(text: string, pattern: RegExp) {
	return toNumber(text.match(pattern)?.[1]);
}

function matchNetSocial(text: string) {
	return matchFirstMoney(
		text,
		new RegExp(String.raw`\bmontant\s+net\s+social\s+${moneyPattern}`, 'i')
	);
}

function matchNetSalary(text: string) {
	return (
		matchNetSocial(text) ??
		matchMoney(text, ['salaire net', 'net paye']) ??
		matchFirstMoney(
			text,
			new RegExp(
				String.raw`\bnet\s+a\s+payer(?!\s+avant\s+impot)[\s\S]{0,45}?${moneyPattern}\s*(?:EUR|€|euros)?`,
				'i'
			)
		)
	);
}

function matchPayrollContributions(text: string) {
	return matchFirstMoney(
		text,
		new RegExp(
			String.raw`\btotal\s+(?:des\s+)?cotisations\s+et\s+contributions\s+${moneyPattern}`,
			'i'
		)
	);
}

function matchPayrollGrossSalary(text: string) {
	return matchFirstMoney(text, new RegExp(String.raw`\bsalaire\s+brut\s+${moneyPattern}`, 'i'));
}

function matchPayrollTaxableNet(text: string) {
	const summary = text.match(/\bnet\s+paye\s+([\s\S]{0,600}?)\s+net\s+paye\s*:/i)?.[1];
	if (!summary) return undefined;

	const amounts = [...summary.matchAll(new RegExp(moneyPattern, 'g'))]
		.map((match) => toNumber(match[1]))
		.filter((value): value is number => value !== undefined);

	// Tableau récapitulatif : net payé, puis brut/base SS/plafond SS (mensuel et annuel),
	// puis net imposable mensuel.
	return amounts[7];
}

function matchContractGrossSalary(text: string) {
	const patterns = [
		new RegExp(
			String.raw`\b(?:a\s+titre\s+de\s+salaire|salaire\s+la\s+somme\s+de|remuneration)[\s\S]{0,100}?${moneyPattern}\s*(?:EUR|\u20ac|euros?)\s+brut(?:s|es)?\b`,
			'i'
		),
		new RegExp(String.raw`\b${moneyPattern}\s*(?:EUR|\u20ac|euros?)\s+brut(?:s|es)?\b`, 'i')
	];

	for (const pattern of patterns) {
		const value = matchFirstMoney(text, pattern);
		if (value !== undefined) return value;
	}

	return undefined;
}

function matchContractTitle(text: string) {
	const searchable = normalizeDateText(text);
	if (
		!/contrat de travail|contrat d engagement|cdd d usage|engagement d artiste|conditions d engagement/.test(
			searchable
		)
	) {
		return '';
	}

	const projectDescription = text.match(
		/\bla description du projet\s*:\s*(.{2,180}?)(?=\s+le projet\b|\s+le num[ée]ro\b|\s+dur[ée]e\b)/i
	)?.[1];

	return (
		projectDescription
			?.replace(/\s+/g, ' ')
			.replace(/[.;,:-]+$/, '')
			.trim() ?? ''
	);
}

function cleanInlineValue(value: string | undefined) {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.replace(/[.;,:-]+$/, '')
		.trim();
}

function isMovinmotionPayroll(text: string) {
	return (
		/\bmovinmotion\b/.test(text) &&
		/\b(?:bulletin de paie|fiche de paie|salaire brut|net a payer|cotisations salariales|net imposable|salaire net)\b/.test(
			text
		)
	);
}

function isMovinmotionCongeSpectacle(text: string) {
	return (
		/\bmovinmotion\b/.test(text) &&
		/\b(?:cong[eé]s?\s+spectacl(?:e|es)|caisse\s+des?\s+cong[eé]s?|certificat\s+de\s+cong[eé]s?)\b/.test(
			text
		)
	);
}

function analyzeMovinmotionContract(text: string) {
	const searchable = normalizeDateText(text);
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];
	const isMovinmotionContract =
		/\bmovinmotion\b/.test(searchable) &&
		/contrat d engagement a duree determinee d usage|nom de la production/.test(searchable);

	if (!isMovinmotionContract) return { fields, notes };

	const periodMatch = searchable.match(
		new RegExp(
			String.raw`\ble salarie est engage du\s+(${frenchDatePattern})\s+au\s+(${frenchDatePattern})`,
			'i'
		)
	);
	const startDate = parseFrenchDate(periodMatch?.[1]);
	const endDate = parseFrenchDate(periodMatch?.[2]);
	const title = cleanInlineValue(
		searchable.match(
			/\bnom de la production\s*:\s*(.{2,120}?)(?=\s+fonction\s*:|\s+numero d objet\s*:|\s+statut\s*:|\s+lieu de travail\s*:|\s+remuneration\s*:|\s+le salarie\b)/i
		)?.[1]
	);
	const employmentStatus = cleanInlineValue(
		searchable.match(
			/\bstatut\s*:\s*(.{2,80}?)(?=\s+lieu de travail\s*:|\s+remuneration\s*:|\s+le salarie\b)/i
		)?.[1]
	);
	const hours = matchFirstMoney(
		searchable,
		new RegExp(String.raw`\bpour une duree de\s+${numberPattern}\s*h\b`, 'i')
	);
	const grossSalary = matchFirstMoney(
		searchable,
		new RegExp(
			String.raw`\bpour une remuneration totale de\s+${moneyPattern}\s*(?:EUR|\u20ac|euros?)\s+brut`,
			'i'
		)
	);

	if (startDate) fields.startDate = startDate;
	if (endDate) fields.endDate = endDate;
	if (title) fields.title = humanizeUpperValue(title);
	if (hours !== undefined) fields.hours = hours;
	if (employmentStatus) fields.employmentStatus = humanizeUpperValue(employmentStatus);
	if (grossSalary !== undefined) fields.grossSalary = grossSalary;

	if (Object.keys(fields).length) {
		notes.push('Contrat Movinmotion analysé depuis ses conditions particulières.');
	}

	return { fields, notes };
}

function analyzeMovinmotionPayroll(text: string) {
	const searchable = normalizeDateText(text);
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];
	const isMovinmotionPayroll =
		/\bmovinmotion\b/.test(searchable) &&
		/\b(?:bulletin de paie|fiche de paie|salaire brut|net a payer|cotisations salariales|net imposable|salaire net)\b/.test(
			searchable
		);

	if (!isMovinmotionPayroll) return { fields, notes };

	const grossSalary =
		matchMoney(searchable, [
			'salaire brut',
			'montant brut',
			'brut total',
			'remuneration brute',
			'remuneration totale',
			'brut apres charges'
		]) ??
		matchFirstMoney(
			searchable,
			new RegExp(String.raw`\b(?:montant\s+brut|brut)\s+${moneyPattern}`, 'i')
		);
	const netSalary = matchNetSalary(searchable);
	const taxableNetSalary = matchMoney(searchable, [
		'net imposable',
		'net fiscal',
		'base imposable',
		'net declarable'
	]);
	const contributions =
		matchPayrollContributions(searchable) ??
		matchMoney(searchable, [
			'cotisations salariales',
			'total cotisations',
			'charges salariales',
			'cotisations'
		]);

	if (grossSalary !== undefined) fields.grossSalary = grossSalary;
	if (netSalary !== undefined) fields.netSalary = netSalary;
	if (taxableNetSalary !== undefined) fields.taxableNetSalary = taxableNetSalary;
	if (contributions !== undefined) fields.contributions = contributions;

	if (Object.keys(fields).length) {
		notes.push('Fiche de paie Movinmotion analysée.');
	}

	return { fields, notes };
}

function analyzeMovinmotionCongeSpectacle(text: string) {
	const searchable = normalizeDateText(text);
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];
	const isMovinmotionCongeSpectacle =
		/\bmovinmotion\b/.test(searchable) &&
		/\b(?:cong[eé]s?\s+spectacl(?:e|es)|caisse\s+des?\s+cong[eé]s?|certificat\s+de\s+cong[eé]s?|indemnit[eé]\s+de\s+cong[eé]s?)\b/.test(
			searchable
		);

	if (!isMovinmotionCongeSpectacle) return { fields, notes };

	const grossSalary = matchMoney(searchable, [
		'montant brut',
		'remuneration brute',
		'brut total',
		'montant total'
	]);
	const netSalary = matchNetSalary(searchable);
	const contributions = matchMoney(searchable, [
		'cotisations salariales',
		'charges salariales',
		'contributions',
		'indemnite'
	]);

	if (grossSalary !== undefined) fields.grossSalary = grossSalary;
	if (netSalary !== undefined) fields.netSalary = netSalary;
	if (contributions !== undefined) fields.contributions = contributions;

	if (Object.keys(fields).length) {
		notes.push('Congé Spectacle Movinmotion analysé.');
	}

	return { fields, notes };
}

function analyzeGhsPayroll(text: string) {
	const fields: Partial<ContractFields> = {};
	const notes: string[] = [];
	const isGhsPayroll =
		/\bghs\b|\bspaiectacle\b/.test(text) &&
		/bulletin de paie/.test(text) &&
		/(montant brut|net a payer avant impot)/.test(text);

	if (!isGhsPayroll) return { fields, notes };

	const grossSalary = matchFirstMoney(
		text,
		new RegExp(String.raw`\bmontant\s+brut\s+${moneyPattern}`, 'i')
	);
	const netSalary = matchNetSocial(text);
	const taxableNetSalary = matchFirstMoney(
		text,
		new RegExp(
			String.raw`\bmontant\s+net\s+imposable[\s\S]{0,80}?\bbase\s+montant\s+${moneyPattern}`,
			'i'
		)
	);
	const contributions = matchFirstMoney(
		text,
		new RegExp(
			String.raw`\btotal\s+cotisations\s+et\s+contrib\.?\s+obligatoires\s+${moneyPattern}`,
			'i'
		)
	);

	if (grossSalary !== undefined) fields.grossSalary = grossSalary;
	if (netSalary !== undefined) fields.netSalary = netSalary;
	if (taxableNetSalary !== undefined) fields.taxableNetSalary = taxableNetSalary;
	if (contributions !== undefined) fields.contributions = contributions;

	if (Object.keys(fields).length) {
		notes.push('Bulletin GHS/sPAIEctacle analysé avec le montant net social.');
	}

	return { fields, notes };
}

function preview(text: string) {
	return text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
}

export function analyzeDocumentText(text: string): DocumentAnalysis {
	const normalized = normalizeText(text);
	const searchable = normalizeDateText(normalized);
	const notes: string[] = [];
	const fields: Partial<ContractFields> = {};
	const aemAnalysis = analyzeAem(normalized);
	const gusoAnalysis = analyzeGusoFields(normalized);
	const ghsPayrollAnalysis = analyzeGhsPayroll(searchable);
	const movinmotionAnalysis = analyzeMovinmotionContract(normalized);
	const movinmotionPayrollAnalysis = analyzeMovinmotionPayroll(searchable);
	const movinmotionCongeSpectacleAnalysis = analyzeMovinmotionCongeSpectacle(searchable);

	if (!normalized) {
		return {
			textPreview: '',
			fields,
			notes: [
				'Le fichier a ete stocke, mais aucun texte exploitable n a ete detecte. Les PDF scannes necessitent une OCR externe.'
			]
		};
	}

	const detectedPeriod =
		matchLabeledWorkPeriod(searchable) ??
		matchExplicitPeriod(searchable) ??
		matchStructuredPeriod(searchable);
	const startDate = detectedPeriod?.startDate ?? matchDate(searchable, ['date de debut', 'debut']);
	const endDate = detectedPeriod?.endDate ?? matchDate(searchable, ['date de fin', 'fin']);
	const detectedHours =
		aemAnalysis.fields.hours ??
		matchWorkedHours(searchable) ??
		(!isAemDocument(searchable)
			? matchNumber(searchable, [
					'nombre d.heures',
					'nombre d heures',
					'heures travaillees',
					'heures declarees',
					'heures effectuees',
					'heures retenues',
					'nb heures'
				])
			: undefined);
	const cachets = matchPayrollCachets(searchable);
	const employmentStatus = matchEmploymentStatus(searchable);
	const title = matchContractTitle(normalized);
	const cachetHours =
		cachets !== undefined && cachets > 0
			? cachets * cachetHoursPerUnit(employmentStatus)
			: undefined;
	const hours = detectedHours ?? cachetHours;
	const grossSalary =
		matchContractGrossSalary(searchable) ??
		matchPayrollGrossSalary(searchable) ??
		matchMoney(searchable, [
			'salaire brut',
			'brut soumis',
			'brut total',
			'remuneration brute',
			'montant brut'
		]);
	const netSalary = matchNetSalary(searchable);
	const taxableNetSalary =
		matchPayrollTaxableNet(searchable) ??
		matchMoney(searchable, ['net imposable', 'net fiscal', 'imposable', 'net declarable']);
	const contributions =
		matchPayrollContributions(searchable) ??
		matchMoney(searchable, [
			'cotisations salariales',
			'total cotisations',
			'charges salariales',
			'cotisations'
		]);

	if (startDate) fields.startDate = startDate;
	if (endDate) fields.endDate = endDate;
	if (title) fields.title = title;
	if (hours !== undefined) fields.hours = hours;
	if (cachets !== undefined) fields.cachets = cachets;
	if (employmentStatus) fields.employmentStatus = employmentStatus;
	if (grossSalary !== undefined) fields.grossSalary = grossSalary;
	if (netSalary !== undefined) fields.netSalary = netSalary;
	if (taxableNetSalary !== undefined) fields.taxableNetSalary = taxableNetSalary;
	if (contributions !== undefined) fields.contributions = contributions;

	Object.assign(fields, gusoAnalysis.fields);
	notes.push(...gusoAnalysis.notes);
	Object.assign(fields, ghsPayrollAnalysis.fields);
	notes.push(...ghsPayrollAnalysis.notes);
	Object.assign(fields, movinmotionAnalysis.fields);
	notes.push(...movinmotionAnalysis.notes);
	Object.assign(fields, movinmotionPayrollAnalysis.fields);
	notes.push(...movinmotionPayrollAnalysis.notes);
	Object.assign(fields, movinmotionCongeSpectacleAnalysis.fields);
	notes.push(...movinmotionCongeSpectacleAnalysis.notes);
	Object.assign(fields, aemAnalysis.fields);
	notes.push(...aemAnalysis.notes);

	if (fields.grossSalary && fields.hours) {
		fields.grossHourlyRate = Number((fields.grossSalary / fields.hours).toFixed(2));
	}

	if (fields.netSalary && fields.hours) {
		fields.netHourlyRate = Number((fields.netSalary / fields.hours).toFixed(2));
	}

	if (detectedHours === undefined && cachetHours !== undefined) {
		notes.push(
			`Cachets convertis en heures (${cachetHoursPerUnit(employmentStatus)} h/cachet, statut ${employmentStatus || 'intermittent'}).`
		);
	}

	if (Object.keys(fields).length === 0) {
		notes.push(
			'Texte detecte, mais aucun champ standard n a pu etre reconnu automatiquement. Le contenu reste consultable dans l apercu.'
		);
	} else {
		notes.push('Champs detectes automatiquement a verifier avant validation.');
	}

	return {
		textPreview: preview(normalized),
		fields,
		notes
	};
}
