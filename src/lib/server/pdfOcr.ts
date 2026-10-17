import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createCanvas } from '@napi-rs/canvas';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
// Locally the French model comes from node_modules. In a serverless bundle (Vercel) it may be
// missing: Tesseract then fetches the same package version from jsDelivr and caches it in /tmp.
function localFrenchLangPath() {
	try {
		return path.dirname(require.resolve('@tesseract.js-data/fra/4.0.0/fra.traineddata.gz'));
	} catch {
		return '';
	}
}

const localLangPath = localFrenchLangPath();
const frenchLanguageData = {
	code: 'fra',
	gzip: true,
	langPath: localLangPath || 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0',
	cached: !localLangPath
};

const targetScale = 2.25;
const maxRenderedPixels = 8_000_000;

function pageScale(width: number, height: number) {
	const pixelLimitedScale = Math.sqrt(maxRenderedPixels / Math.max(width * height, 1));
	return Math.min(targetScale, pixelLimitedScale);
}

async function renderPage(document: PDFDocumentProxy, pageNumber: number) {
	const page = await document.getPage(pageNumber);
	const baseViewport = page.getViewport({ scale: 1 });
	const scale = pageScale(baseViewport.width, baseViewport.height);
	const viewport = page.getViewport({ scale });
	const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
	const canvasContext = canvas.getContext('2d');

	await page.render({
		canvas: null,
		canvasContext: canvasContext as unknown as CanvasRenderingContext2D,
		viewport
	}).promise;

	page.cleanup();
	return canvas.toBuffer('image/png');
}

export async function recognizePdfPages(document: PDFDocumentProxy, pageNumbers: number[]) {
	if (!pageNumbers.length) return new Map<number, string>();

	const worker = await Tesseract.createWorker(frenchLanguageData.code, Tesseract.OEM.LSTM_ONLY, {
		cacheMethod: frenchLanguageData.cached ? 'write' : 'none',
		cachePath: frenchLanguageData.cached ? tmpdir() : undefined,
		gzip: frenchLanguageData.gzip,
		langPath: frenchLanguageData.langPath
	});
	const pages = new Map<number, string>();

	try {
		await worker.setParameters({
			preserve_interword_spaces: '1',
			tessedit_pageseg_mode: Tesseract.PSM.AUTO,
			user_defined_dpi: String(Math.round(72 * targetScale))
		});

		for (const pageNumber of pageNumbers) {
			const image = await renderPage(document, pageNumber);
			const result = await worker.recognize(image);
			pages.set(pageNumber, result.data.text.trim());
		}
	} finally {
		await worker.terminate();
	}

	return pages;
}
