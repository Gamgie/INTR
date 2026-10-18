import { PDFDocument } from 'pdf-lib';

import {
	classifyDocumentKind,
	extractPdfDocumentText,
	extractPdfTextFromBuffer,
	extractTextFromBuffer
} from '$lib/server/documentAnalysis';
import type { DocumentKind } from '$lib/types';

export type DocumentPart = {
	kind: DocumentKind;
	buffer: Buffer;
	text: string;
	fileName: string;
	pageStart: number;
	pageEnd: number;
	isSplit: boolean;
	extractionNotes: string[];
};

function extractionNotes(
	extraction: Awaited<ReturnType<typeof extractPdfDocumentText>>,
	pageIndexes: number[]
) {
	const pageNumbers = new Set(pageIndexes.map((index) => index + 1));
	const ocrCount = extraction.ocrPageNumbers.filter((page) => pageNumbers.has(page)).length;
	const attemptedCount = extraction.ocrAttemptedPageNumbers.filter((page) =>
		pageNumbers.has(page)
	).length;
	const skippedCount = extraction.ocrSkippedPageNumbers.filter((page) =>
		pageNumbers.has(page)
	).length;
	const notes: string[] = [];

	if (ocrCount) {
		notes.push(
			`OCR française appliquée à ${ocrCount} page${ocrCount > 1 ? 's' : ''} scannée${ocrCount > 1 ? 's' : ''}.`
		);
	}
	if (extraction.ocrFailed && attemptedCount) {
		notes.push("L'OCR française n'a pas pu analyser toutes les pages scannées.");
	}
	if (skippedCount) {
		notes.push(
			`${skippedCount} page${skippedCount > 1 ? 's' : ''} scannée${skippedCount > 1 ? 's' : ''} non analysée${skippedCount > 1 ? 's' : ''} (limite OCR de 20 pages).`
		);
	}

	return notes;
}

function suffixFileName(fileName: string, pageStart: number, pageEnd: number) {
	const dot = fileName.lastIndexOf('.');
	const base = dot > 0 ? fileName.slice(0, dot) : fileName;
	const ext = dot > 0 ? fileName.slice(dot) : '.pdf';
	const pages = pageStart === pageEnd ? `p${pageStart}` : `p${pageStart}-${pageEnd}`;
	return `${base}-${pages}${ext}`;
}

function normalizeFileHint(value: string) {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export function documentKindFromFileName(fileName: string, fallback: DocumentKind): DocumentKind {
	const normalized = normalizeFileHint(fileName);
	const prefix = normalized.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim() ?? '';
	const searchable = prefix || normalized.replace(/\.[^.]+$/, '');
	const tokens = searchable.split(/[^a-z0-9]+/).filter(Boolean);

	if (tokens.includes('aem')) return 'AEM';
	if (tokens.includes('bp') || /\b(?:bulletin|fiche|paie)\b/.test(searchable)) {
		return 'Fiche de paie';
	}
	if (tokens.includes('cs') || /\b(?:conge|conges|spectacle|spectacles)\b/.test(searchable)) {
		return 'Congé Spectacle';
	}
	if (tokens.includes('guso')) return 'Déclaration Guso';
	if (
		tokens.includes('are') ||
		/\b(?:notification|france\s+travail|pole\s+emploi)\b/.test(searchable)
	) {
		return 'Notification ARE';
	}
	if (tokens.includes('contrat')) return 'Contrat';

	return fallback;
}

function explicitDocumentKindFromFileName(fileName: string): DocumentKind | undefined {
	const normalized = normalizeFileHint(fileName).replace(/\.[^.]+$/, '');
	const prefix = normalized.match(/^\s*(?:\[\s*)?([a-z]+)(?:\s*\]|[-_\s]|$)/)?.[1];

	if (prefix === 'aem') return 'AEM';
	if (prefix === 'bp') return 'Fiche de paie';
	if (prefix === 'cs') return 'Congé Spectacle';
	if (prefix === 'guso') return 'Déclaration Guso';
	if (prefix === 'are') return 'Notification ARE';
	if (prefix === 'contrat') return 'Contrat';

	return undefined;
}

function classifyWithFileName(text: string, fileName: string, fallbackKind: DocumentKind) {
	return classifyDocumentKind(text, documentKindFromFileName(fileName, fallbackKind));
}

async function createPdfFromPages(source: PDFDocument, pageIndexes: number[]) {
	const output = await PDFDocument.create();
	const pages = await output.copyPages(source, pageIndexes);
	for (const page of pages) output.addPage(page);
	return Buffer.from(await output.save());
}

export async function splitAndClassifyDocument(
	fileName: string,
	mimeType: string,
	buffer: Buffer,
	fallbackKind: DocumentKind
): Promise<DocumentPart[]> {
	const lowerName = fileName.toLowerCase();
	const lowerType = mimeType.toLowerCase();

	if (!lowerName.endsWith('.pdf') && !lowerType.includes('pdf')) {
		const text = await extractTextFromBuffer(fileName, mimeType, buffer);
		return [
			{
				kind: classifyWithFileName(text, fileName, fallbackKind),
				buffer,
				text,
				fileName,
				pageStart: 1,
				pageEnd: 1,
				isSplit: false,
				extractionNotes: []
			}
		];
	}

	try {
		const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
		const pageCount = source.getPageCount();
		const explicitKind = explicitDocumentKindFromFileName(fileName);
		const extraction = await extractPdfDocumentText(buffer);
		const fullText = extraction.text;
		const fullKind = explicitKind ?? classifyWithFileName(fullText, fileName, fallbackKind);
		const allPageIndexes = Array.from({ length: pageCount }, (_, index) => index);

		if (pageCount <= 1 || explicitKind) {
			return [
				{
					kind: fullKind,
					buffer,
					text: fullText,
					fileName,
					pageStart: 1,
					pageEnd: pageCount,
					isSplit: false,
					extractionNotes: extractionNotes(extraction, allPageIndexes)
				}
			];
		}

		const pageTexts = extraction.pages;
		const pages = await Promise.all(
			Array.from({ length: pageCount }, async (_, index) => {
				const text = pageTexts[index] || fullText;
				return {
					index,
					text,
					kind: classifyWithFileName(text || fullText, fileName, fullKind)
				};
			})
		);

		const hasSeveralKinds = new Set(pages.map((page) => page.kind)).size > 1;
		if (!hasSeveralKinds) {
			return [
				{
					kind: pages[0]?.kind ?? fullKind,
					buffer,
					text: fullText,
					fileName,
					pageStart: 1,
					pageEnd: pageCount,
					isSplit: false,
					extractionNotes: extractionNotes(extraction, allPageIndexes)
				}
			];
		}

		const groups: { kind: DocumentKind; indexes: number[]; text: string }[] = [];
		for (const page of pages) {
			const last = groups.at(-1);
			if (last && last.kind === page.kind) {
				last.indexes.push(page.index);
				last.text = `${last.text}\n\n${page.text}`.trim();
			} else {
				groups.push({ kind: page.kind, indexes: [page.index], text: page.text });
			}
		}

		return Promise.all(
			groups.map(async (group) => {
				const pageStart = group.indexes[0] + 1;
				const pageEnd = group.indexes[group.indexes.length - 1] + 1;
				const groupBuffer = await createPdfFromPages(source, group.indexes);

				return {
					kind: group.kind,
					buffer: groupBuffer,
					text: group.text,
					fileName: suffixFileName(fileName, pageStart, pageEnd),
					pageStart,
					pageEnd,
					isSplit: true,
					extractionNotes: extractionNotes(extraction, group.indexes)
				};
			})
		);
	} catch {
		const text = extractPdfTextFromBuffer(buffer);
		return [
			{
				kind: classifyWithFileName(text, fileName, fallbackKind),
				buffer,
				text,
				fileName,
				pageStart: 1,
				pageEnd: 1,
				isSplit: false,
				extractionNotes: []
			}
		];
	}
}

export type DocumentBundle = { fileName: string; buffer: Buffer; pageStart: number; pageEnd: number };

type Period = { start: string; end: string };

function isoFromParts(day: string, month: string, year: string) {
	const fullYear = year.length === 2 ? `20${year}` : year;
	return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Période d'une page : « du 01/11/24 au 02/11/24 » (bulletin GHS), « 01/10/2021 au 02/10/2021 »
// (Lit Up), « 29 10 2024 02 11 2024 » (AEM GHS, certificat Audiens).
export function pagePeriod(text: string): Period | undefined {
	const slashed = text.match(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4}) au (\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/);
	const spaced = text.match(/\b(\d{2}) (\d{2}) (\d{4}) (\d{2}) (\d{2}) (\d{4})\b/);
	const match = slashed ?? spaced;
	if (!match) return undefined;
	const start = isoFromParts(match[1], match[2], match[3]);
	const end = isoFromParts(match[4], match[5], match[6]);
	return start <= end ? { start, end } : undefined;
}

const overlap = (a: Period, b: Period) =>
	Math.max(0, Math.min(Date.parse(a.end), Date.parse(b.end)) - Math.max(Date.parse(a.start), Date.parse(b.start)) + 86_400_000);

// Un PDF qui regroupe plusieurs paies (Zeendoc : tous les bulletins du mois, puis toutes les AEM,
// puis tous les certificats) est découpé en lots, un par bulletin : le bulletin, et l'AEM et le
// certificat dont la période le recouvre. Chaque lot est ensuite importé comme un fichier, et
// rattaché à son propre contrat.
export async function splitIntoBundles(fileName: string, buffer: Buffer): Promise<DocumentBundle[]> {
	const whole = [{ fileName, buffer, pageStart: 1, pageEnd: 1 }];
	if (!fileName.toLowerCase().endsWith('.pdf')) return whole;

	try {
		const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
		const pageCount = source.getPageCount();
		whole[0].pageEnd = pageCount;
		if (pageCount < 2) return whole;

		const { pages } = await extractPdfDocumentText(buffer);
		const info = pages.map((text, index) => ({
			index,
			kind: classifyDocumentKind(text, 'Autre'),
			period: pagePeriod(text)
		}));
		const anchors: Period[] = [];
		for (const page of info) {
			if (page.kind !== 'Fiche de paie' || !page.period) continue;
			if (!anchors.some((anchor) => anchor.start === page.period!.start && anchor.end === page.period!.end)) {
				anchors.push(page.period);
			}
		}
		if (anchors.length < 2) return whole;

		const groups = anchors.map(() => [] as number[]);
		let previous = 0;
		for (const page of info) {
			let target = previous;
			if (page.period) {
				const scores = anchors.map((anchor) => overlap(anchor, page.period!));
				const best = Math.max(...scores);
				if (best > 0) target = scores.indexOf(best);
			}
			groups[target].push(page.index);
			previous = target;
		}

		const dot = fileName.lastIndexOf('.');
		const base = dot > 0 ? fileName.slice(0, dot) : fileName;
		const bundles: DocumentBundle[] = [];
		for (const [index, indexes] of groups.entries()) {
			if (!indexes.length) continue;
			bundles.push({
				fileName: `${base} (${anchors[index].start}).pdf`,
				buffer: await createPdfFromPages(source, indexes),
				pageStart: indexes[0] + 1,
				pageEnd: indexes.at(-1)! + 1
			});
		}
		return bundles.length > 1 ? bundles : whole;
	} catch {
		return whole;
	}
}
