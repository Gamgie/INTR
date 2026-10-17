
import { error, json, type RequestHandler } from '@sveltejs/kit';

import { normalizeCompanyColor } from '$lib/companyColors';
import { analyzeAreNotification } from '$lib/server/areAnalysis';
import { searchCompanies } from '$lib/server/companySearch';
import {
	deriveMissingPayFields,
	findProjectForProduction,
	importedContractTitle
} from '$lib/server/contractImport';
import { analyzeDocumentText } from '$lib/server/documentAnalysis';
import {
	companyNameFromFileName,
	contractEmployerRelationship,
	dateFromFileName,
	extractSirets,
	findExistingContract,
	normalizeDigits,
	normalizeSearch,
	parseDate,
	rangesOverlap
} from '$lib/server/contractMatching';
import { documentKindFromFileName, splitAndClassifyDocument } from '$lib/server/pdfParts';
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
import type {
	AppData,
	Company,
	CompanySearchResult,
	Contract,
	ContractDocument,
	ContractFields,
	CompanySuggestion,
	DocumentKind,
	IntermittencePeriod,
	ContractStatus
} from '$lib/types';

function sanitizeFileName(name: string) {
	return name
		.normalize('NFKD')
		.replace(/[^\w.\- ]+/g, '')
		.replace(/\s+/g, '-')
		.slice(0, 120);
}

function safeKind(value: FormDataEntryValue | null): DocumentKind {
	return value === 'AEM' ||
		value === 'Contrat' ||
		value === 'Fiche de paie' ||
		value === 'Congé Spectacle' ||
		value === 'Déclaration Guso' ||
		value === 'Notification ARE' ||
		value === 'Autre'
		? value
		: 'Autre';
}

function shouldUseFileDate(currentDate: string | undefined, fileDate: string) {
	if (!fileDate) return false;
	if (!currentDate) return true;

	const current = parseDate(currentDate);
	const hinted = parseDate(fileDate);
	if (!current || !hinted) return true;

	return Math.abs(current.getFullYear() - hinted.getFullYear()) > 1;
}

function applyFileNameFieldHints(
	fileName: string,
	fields: Partial<ContractFields>,
	analysisNotes: string[]
) {
	const fileDate = dateFromFileName(fileName);
	const nextFields = { ...fields };
	const nextNotes = [...analysisNotes];
	let applied = false;

	if (fileDate && shouldUseFileDate(nextFields.startDate, fileDate)) {
		nextFields.startDate = fileDate;
		applied = true;
	}

	if (fileDate && shouldUseFileDate(nextFields.endDate, fileDate)) {
		nextFields.endDate = fileDate;
		applied = true;
	}

	const start = nextFields.startDate ? parseDate(nextFields.startDate) : undefined;
	const end = nextFields.endDate ? parseDate(nextFields.endDate) : undefined;
	if (start && end && end < start) {
		nextFields.endDate = nextFields.startDate;
		applied = true;
	}

	if (applied) nextNotes.push('Date du nom de fichier utilisee comme repere de regroupement.');

	return { fields: nextFields, notes: nextNotes };
}

function statusFromDocuments(documents: ContractDocument[]): ContractStatus | undefined {
	if (
		documents.some(
			(document) =>
				document.kind === 'AEM' ||
				document.kind === 'Fiche de paie' ||
				document.kind === 'Congé Spectacle' ||
				document.kind === 'Déclaration Guso'
		)
	) {
		return 'Payé';
	}

	if (documents.some((document) => document.kind === 'Contrat')) {
		return 'Signé';
	}

	return undefined;
}

function applyStatusFromDocuments(contract: Contract, documents: ContractDocument[]) {
	const nextStatus = statusFromDocuments(documents);
	if (!nextStatus) return undefined;

	if (contract.status === 'Payé') return undefined;
	if (contract.status === 'Signé' && nextStatus === 'Signé') return undefined;

	contract.status = nextStatus;
	contract.updatedAt = new Date().toISOString();
	return nextStatus;
}

function titleFromFileName(fileName: string) {
	const companyName = companyNameFromFileName(fileName);
	const fileDate = dateFromFileName(fileName);
	if (companyName && fileDate) return `Contrat - ${companyName} - ${fileDate}`;
	if (companyName) return `Contrat - ${companyName}`;

	const title = fileName
		.replace(/\.[^.]+$/, '')
		.replace(/[-_]+/g, ' ')
		.trim();
	return title ? `Contrat - ${title}` : 'Contrat importé';
}

function createImportedContract(id: string, fileName: string): Contract {
	const now = new Date().toISOString();

	return {
		id,
		companyId: '',
		projectId: '',
		title: titleFromFileName(fileName),
		startDate: '',
		endDate: '',
		hours: 0,
		cachets: 0,
		employmentStatus: '',
		netSalary: 0,
		taxableNetSalary: 0,
		grossSalary: 0,
		contributions: 0,
		netHourlyRate: 0,
		grossHourlyRate: 0,
		status: 'Estimation',
		notes: '',
		documentIds: [],
		createdAt: now,
		updatedAt: now
	};
}

function mergeDetectedFields(contract: Contract, fields: Partial<ContractFields>) {
	const applied: Partial<ContractFields> = {};

	for (const [key, value] of Object.entries(fields) as [
		keyof ContractFields,
		ContractFields[keyof ContractFields]
	][]) {
		const current = contract[key];
		const isEmptyString = typeof current === 'string' && current.trim() === '';
		const isEmptyNumber = typeof current === 'number' && current === 0;
		const isGeneratedImportTitle =
			key === 'title' &&
			contract.documentIds.length === 0 &&
			typeof current === 'string' &&
			(current === 'Contrat importé' || current.startsWith('Contrat - '));

		if (isEmptyString || isEmptyNumber || isGeneratedImportTitle) {
			(contract[key] as ContractFields[keyof ContractFields]) = value;
			(applied[key] as ContractFields[keyof ContractFields]) = value;
		}
	}

	const derivedFields = deriveMissingPayFields(contract);
	Object.assign(contract, derivedFields);
	Object.assign(applied, derivedFields);

	contract.updatedAt = new Date().toISOString();
	return applied;
}

function mergeAppliedFields(target: Partial<ContractFields>, source: Partial<ContractFields>) {
	for (const [key, value] of Object.entries(source) as [
		keyof ContractFields,
		ContractFields[keyof ContractFields]
	][]) {
		(target[key] as ContractFields[keyof ContractFields]) = value;
	}
}

function companyFromSearchResult(result: CompanySearchResult): Company {
	const id = createId('company');
	const name = result.name || result.legalName || 'Structure importée';

	return {
		id,
		name,
		legalName: result.legalName,
		contactName: '',
		email: '',
		phone: '',
		address: result.address,
		postalCode: result.postalCode,
		city: result.city,
		siren: result.siren,
		siret: result.siret,
		ape: result.ape,
		legalCategory: result.legalCategory,
		activityLabel: result.activityLabel,
		color: normalizeCompanyColor('', `${id}:${name}`),
		source: result.sourceUrl,
		sourceUpdatedAt: result.sourceUpdatedAt,
		notes: 'Structure créée automatiquement depuis un document Guso.'
	};
}

function textIncludesIdentifier(text: string, identifier: string) {
	const normalizedIdentifier = normalizeDigits(identifier);
	return normalizedIdentifier.length >= 9 && normalizeDigits(text).includes(normalizedIdentifier);
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

function meaningfulTokens(value: string) {
	return normalizeSearch(value)
		.split(' ')
		.filter(
			(token) => token.length >= 4 && !['compagnie', 'association', 'theatre'].includes(token)
		);
}

function detectCompanyId(data: AppData, text: string) {
	const searchableText = normalizeSearch(text);

	for (const company of data.companies) {
		if (
			(company.siret && textIncludesIdentifier(text, company.siret)) ||
			(company.siren && textIncludesIdentifier(text, company.siren))
		) {
			return company.id;
		}
	}

	const scored = data.companies
		.map((company) => {
			const tokens = meaningfulTokens(`${company.legalName} ${company.name}`);
			const matches = tokens.filter((token) => searchableText.includes(token)).length;
			return { company, score: tokens.length ? matches / tokens.length : 0 };
		})
		.filter((item) => item.score >= 0.66)
		.sort((a, b) => b.score - a.score);

	return scored[0]?.company.id ?? '';
}

function mergeFields(fields: Partial<ContractFields>[]) {
	const merged: Partial<ContractFields> = {};

	for (const fieldSet of fields) {
		for (const [key, value] of Object.entries(fieldSet) as [
			keyof ContractFields,
			ContractFields[keyof ContractFields]
		][]) {
			const current = merged[key];
			const isEmptyString = typeof current === 'string' && current.trim() === '';
			const isEmptyNumber = typeof current === 'number' && current === 0;

			if (current === undefined || isEmptyString || isEmptyNumber) {
				(merged[key] as ContractFields[keyof ContractFields]) = value;
			}
		}
	}

	return merged;
}

function findDocumentConflicts(
	existingDocuments: ContractDocument[],
	document: ContractDocument,
	contractId: string
) {
	const notes: string[] = [];
	let duplicate = false;

	for (const existing of existingDocuments) {
		const sameFile =
			existing.originalFileName === document.originalFileName ||
			existing.fileName === document.fileName;
		const sameKind = existing.kind === document.kind;
		const sameContract = existing.contractId === contractId;

		if (sameFile && sameKind && existing.size === document.size) {
			duplicate = true;
			notes.push(`Doublon ignoré: ${document.fileName} existe déjà.`);
			continue;
		}

		if (
			sameFile &&
			existing.pageStart <= document.pageEnd &&
			document.pageStart <= existing.pageEnd
		) {
			notes.push(
				`Conflit de pages: ${document.fileName} chevauche les pages ${existing.pageStart}-${existing.pageEnd}.`
			);
		}

		if (
			sameContract &&
			sameKind &&
			existing.extractedFields.startDate &&
			document.extractedFields.startDate &&
			rangesOverlap(
				existing.extractedFields.startDate,
				existing.extractedFields.endDate || existing.extractedFields.startDate,
				document.extractedFields.startDate,
				document.extractedFields.endDate || document.extractedFields.startDate
			)
		) {
			notes.push(
				`Document potentiellement redondant: ${document.kind} chevauche ${existing.fileName}.`
			);
		}
	}

	return { duplicate, notes };
}

async function proxyToRemote(
	request: Request,
	url: URL,
	contractId: string,
	kind: DocumentKind,
	createContract: boolean,
	autoRoute: boolean,
	file: File,
	buffer: Buffer
) {
	const localData = await readData();
	if (
		!isRemoteSyncEnabled(localData) ||
		isSyncRequest(request) ||
		isSameDeployment(localData.settings.remoteBaseUrl, url)
	) {
		return undefined;
	}

	await pushDataToRemote(localData, globalThis.fetch);

	const remoteBaseUrl = normalizeRemoteBaseUrl(localData.settings.remoteBaseUrl);
	const body = new FormData();
	if (contractId) body.set('contractId', contractId);
	if (createContract) body.set('createContract', 'true');
	if (autoRoute) body.set('autoRoute', 'true');
	body.set('kind', kind);
	body.set(
		'file',
		new File([new Blob([Uint8Array.from(buffer)])], file.name, {
			type: file.type || 'application/pdf'
		})
	);

	const response = await globalThis.fetch(`${remoteBaseUrl}/api/documents`, {
		method: 'POST',
		headers: syncHeaders(),
		body
	});
	const payload = await response.json().catch(() => ({ message: 'Réponse distante illisible.' }));

	if (!response.ok) {
		error(response.status, payload.message ?? 'Upload distant impossible.');
	}

	if (payload.data) await saveData(payload.data);
	return payload;
}

function routeErrorStatus(cause: unknown) {
	if (cause && typeof cause === 'object' && 'status' in cause) {
		const status = Number((cause as { status: unknown }).status);
		if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
	}

	if (cause instanceof TypeError && cause.message.includes('Content-Type was not one of')) {
		return 400;
	}

	return 500;
}

function routeErrorMessage(cause: unknown) {
	if (cause && typeof cause === 'object' && 'body' in cause) {
		const body = (cause as { body?: { message?: unknown } }).body;
		if (typeof body?.message === 'string' && body.message.trim()) return body.message;
	}

	if (cause instanceof Error && cause.message.trim()) return cause.message;
	return 'Import du document impossible.';
}

async function importDocument({ request, url }: Parameters<RequestHandler>[0]) {
	const form = await request.formData();
	const contractId = String(form.get('contractId') ?? '');
	const createContract = String(form.get('createContract') ?? '') === 'true';
	const autoRoute = String(form.get('autoRoute') ?? '') === 'true';
	const file = await formFile(form);

	if (!contractId && !createContract && !autoRoute) error(400, 'Identifiant de contrat manquant.');

	const kind = documentKindFromFileName(file.name, safeKind(form.get('kind')));
	const buffer = Buffer.from(await file.arrayBuffer());
	const safeName = sanitizeFileName(file.name || 'document');
	const newContractId = createId('contract');
	const targetContractId = contractId || newContractId;

	const remotePayload = await proxyToRemote(
		request,
		url,
		contractId,
		kind,
		createContract,
		autoRoute,
		file,
		buffer
	);
	if (remotePayload) return json(remotePayload);

	const parts = await splitAndClassifyDocument(file.name, file.type, buffer, kind);
	const preparedDocuments: ContractDocument[] = [];
	const preparedPeriods: IntermittencePeriod[] = [];
	const preparedDocumentTexts = new Map<string, string>();
	const notes: string[] = [];
	let appliedFields: Partial<ContractFields> = {};

	for (const part of parts) {
		const id = createId(part.kind === 'Notification ARE' ? 'period' : 'document');
		const partSafeName = sanitizeFileName(part.fileName || safeName || 'document.pdf');
		const storedName = `${id}-${partSafeName || 'document.pdf'}`;
		await writeStoredFile(
			storedName,
			part.buffer,
			partSafeName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.type
		);

		if (part.kind === 'Notification ARE') {
			const period = analyzeAreNotification(part.text, {
				id,
				fileName: part.fileName,
				storedName
			});
			preparedPeriods.push(period);
			notes.push(...period.analysisNotes);
			continue;
		}

		const analysis = analyzeDocumentText(part.text);
		const hintedAnalysis = applyFileNameFieldHints(part.fileName || file.name, analysis.fields, [
			...part.extractionNotes,
			...analysis.notes
		]);
		preparedDocumentTexts.set(id, part.text);
		preparedDocuments.push({
			id,
			contractId: targetContractId,
			kind: part.kind,
			fileName: part.fileName,
			originalFileName: file.name,
			storedName,
			mimeType:
				file.type ||
				(part.fileName.toLowerCase().endsWith('.pdf')
					? 'application/pdf'
					: 'application/octet-stream'),
			size: part.buffer.length,
			pageStart: part.pageStart,
			pageEnd: part.pageEnd,
			uploadedAt: new Date().toISOString(),
			extractedTextPreview: analysis.textPreview,
			extractedFields: hintedAnalysis.fields,
			analysisNotes: hintedAnalysis.notes
		});
		notes.push(...hintedAnalysis.notes);
	}

	if (parts.length > 1 && parts.some((part) => part.isSplit)) {
		notes.unshift(`PDF découpé automatiquement en ${parts.length} documents.`);
	}

	let resolvedContractId = contractId;
	let createdNewContract = false;
	let missingCompanySirets: string[] = [];

	const combinedFields = mergeFields(preparedDocuments.map((document) => document.extractedFields));
	const combinedText = preparedDocuments
		.map(
			(document) =>
				`${document.fileName}\n${document.extractedTextPreview}\n${
					preparedDocumentTexts.get(document.id) ?? ''
				}`
		)
		.join('\n\n');
	const incomingSirets = extractSirets(combinedText);
	const productionName =
		preparedDocuments
			.find((document) => document.kind === 'Contrat' && document.extractedFields.title)
			?.extractedFields.title?.trim() ?? '';

	let data = await mutateData((current) => {
		const detectedCompanyId = detectCompanyId(current, combinedText);
		const matchedProject = findProjectForProduction(
			current.projects,
			productionName,
			detectedCompanyId
		);
		const routedCompanyId = detectedCompanyId || matchedProject?.companyId || '';
		const knownSirets = new Set(current.companies.map((company) => normalizeDigits(company.siret)));
		missingCompanySirets = detectedCompanyId
			? []
			: incomingSirets
					.filter((siret) => siret.length === 14 && !knownSirets.has(siret))
					.slice(0, 3);

		let contract = contractId
			? current.contracts.find((item) => item.id === contractId)
			: undefined;
		if (contract) {
			const selectedContract = contract;
			const contractDocuments = current.documents.filter(
				(document) => document.contractId === selectedContract.id
			);
			const employerRelationship = contractEmployerRelationship(
				current,
				selectedContract,
				contractDocuments,
				routedCompanyId,
				incomingSirets
			);

			if (employerRelationship === 'different') {
				notes.push(
					'Employeur différent détecté: le document ne peut pas être rattaché au contrat sélectionné.'
				);
				if (!autoRoute) {
					error(409, 'Ce document appartient à un autre employeur que le contrat sélectionné.');
				}
				contract = undefined;
			}
		}

		if (!contract) {
			contract = findExistingContract(
				current,
				combinedFields,
				routedCompanyId,
				matchedProject?.id ?? '',
				incomingSirets,
				file.name
			);
		}

		if (!contract && (createContract || autoRoute) && preparedDocuments.length) {
			resolvedContractId = newContractId;
			contract = createImportedContract(newContractId, file.name);
			contract.companyId = routedCompanyId;
			contract.projectId = matchedProject?.id ?? '';
			createdNewContract = true;
			current.contracts.unshift(contract);
		} else if (contract) {
			resolvedContractId = contract.id;
			if (autoRoute && !contract.companyId && routedCompanyId) {
				contract.companyId = routedCompanyId;
			}
			if (
				autoRoute &&
				matchedProject &&
				(!contract.companyId || contract.companyId === matchedProject.companyId)
			) {
				contract.projectId = matchedProject.id;
				if (!contract.companyId) contract.companyId = matchedProject.companyId;
			}
		}

		if (!contract && preparedDocuments.length) error(404, 'Contrat introuvable.');

		const acceptedDocuments: ContractDocument[] = [];

		for (const document of preparedDocuments) {
			if (contract) {
				document.contractId = contract.id;
				if (detectedCompanyId && !document.extractedFields.companyId) {
					document.extractedFields.companyId = detectedCompanyId;
				}
				mergeAppliedFields(appliedFields, mergeDetectedFields(contract, document.extractedFields));

				const conflicts = findDocumentConflicts(current.documents, document, contract.id);
				if (conflicts.notes.length) {
					document.analysisNotes = [...document.analysisNotes, ...conflicts.notes];
					notes.push(...conflicts.notes);
				}
				if (!conflicts.duplicate) acceptedDocuments.push(document);
			}
		}

		if (contract && acceptedDocuments.length) {
			const nextStatus = applyStatusFromDocuments(contract, acceptedDocuments);
			if (nextStatus) {
				appliedFields.status = nextStatus;
				notes.push(
					nextStatus === 'Payé'
						? 'Statut du contrat passé automatiquement en Payé.'
						: 'Statut du contrat passé automatiquement en Signé.'
				);
			}
		}

		if (contract && autoRoute) {
			const linkedProject = current.projects.find((project) => project.id === contract.projectId);
			const company = current.companies.find((item) => item.id === contract.companyId);
			const titleSubject =
				matchedProject?.name ||
				productionName ||
				linkedProject?.name ||
				company?.name ||
				company?.legalName ||
				'';
			const shouldRefreshTitle =
				createdNewContract || Boolean(productionName) || contract.title.startsWith('Contrat - ');

			if (titleSubject && shouldRefreshTitle) {
				const nextTitle = importedContractTitle(
					titleSubject,
					contract.startDate || combinedFields.startDate || contract.endDate
				);
				if (contract.title !== nextTitle) {
					contract.title = nextTitle;
					contract.updatedAt = new Date().toISOString();
					appliedFields.title = nextTitle;
				}
			}
		}

		current.documents = [...acceptedDocuments, ...current.documents];
		if (contract) {
			contract.documentIds = [
				...acceptedDocuments.map((document) => document.id),
				...contract.documentIds.filter(
					(id) => !acceptedDocuments.some((document) => document.id === id)
				)
			];
		}

		if (preparedPeriods.length) {
			const existingPeriod = current.periods.find((period) =>
				preparedPeriods.some((created) => isSamePeriod(period, created))
			);

			if (existingPeriod) {
				for (const created of preparedPeriods) created.id = existingPeriod.id;
			}

			current.periods = [
				...preparedPeriods,
				...current.periods.filter(
					(period) => !preparedPeriods.some((created) => created.id === period.id)
				)
			];
			current.settings.activePeriodId = preparedPeriods[0].id;
			if (preparedPeriods[0].referenceStartDate) {
				current.settings.referenceStartDate = preparedPeriods[0].referenceStartDate;
			}
			if (preparedPeriods[0].dailyAllowance) {
				current.settings.minDailyAllowance = preparedPeriods[0].dailyAllowance;
			}
		}

		return current;
	});

	const shouldAutoCreateCompany = preparedDocuments.some(
		(document) => document.kind === 'Déclaration Guso'
	);
	let companySuggestions: CompanySuggestion[] = [];
	for (const siret of missingCompanySirets) {
		try {
			const results = await searchCompanies(siret, fetch, 3);
			const result = results.find((item) => normalizeDigits(item.siret) === siret) ?? results[0];

			if (result) {
				companySuggestions.push({
					contractId: resolvedContractId,
					siret,
					result
				});
				notes.push(
					shouldAutoCreateCompany && normalizeDigits(result.siret) === siret
						? `Structure officielle trouvée via SIRET Guso ${siret}: ${result.name}.`
						: `Structure inconnue détectée via SIRET ${siret}: ${result.name}.`
				);
			}
		} catch {
			notes.push(
				`Structure inconnue détectée via SIRET ${siret}, recherche officielle indisponible.`
			);
		}
	}

	const autoCompanySuggestions = shouldAutoCreateCompany
		? companySuggestions.filter(
				(suggestion) =>
					normalizeDigits(suggestion.result.siret) === normalizeDigits(suggestion.siret)
			)
		: [];

	if (autoCompanySuggestions.length) {
		data = await mutateData((current) => {
			for (const suggestion of autoCompanySuggestions) {
				const resultSiret = normalizeDigits(suggestion.result.siret || suggestion.siret);
				const resultSiren = normalizeDigits(suggestion.result.siren);
				let company = current.companies.find(
					(item) =>
						(resultSiret && normalizeDigits(item.siret) === resultSiret) ||
						(resultSiren && normalizeDigits(item.siren) === resultSiren)
				);

				if (!company) {
					company = companyFromSearchResult(suggestion.result);
					current.companies.unshift(company);
					notes.push(`Structure créée automatiquement depuis le SIRET Guso ${resultSiret}.`);
				}

				const contract = current.contracts.find((item) => item.id === suggestion.contractId);
				if (contract) {
					contract.companyId = company.id;
					const project = current.projects.find((item) => item.id === contract.projectId);
					if (project && project.companyId !== company.id) contract.projectId = '';
					contract.updatedAt = new Date().toISOString();
				}

				for (const document of current.documents) {
					if (
						document.contractId === suggestion.contractId &&
						!document.extractedFields.companyId
					) {
						document.extractedFields.companyId = company.id;
					}
				}
			}

			return current;
		});

		const autoKeys = new Set(
			autoCompanySuggestions.map((suggestion) => `${suggestion.contractId}:${suggestion.siret}`)
		);
		companySuggestions = companySuggestions.filter(
			(suggestion) => !autoKeys.has(`${suggestion.contractId}:${suggestion.siret}`)
		);
	}

	return json({
		data,
		createdContractId: createdNewContract ? resolvedContractId : '',
		routedContractId: resolvedContractId,
		documentIds: data.documents
			.filter((document) => preparedDocuments.some((created) => created.id === document.id))
			.map((document) => document.id),
		periodIds: preparedPeriods.map((period) => period.id),
		companySuggestions,
		appliedFields,
		analysis: {
			textPreview: [...preparedDocuments, ...preparedPeriods]
				.map((item) =>
					'extractedTextPreview' in item ? item.extractedTextPreview : item.sourceTextPreview
				)
				.filter(Boolean)
				.join('\n\n')
				.slice(0, 1600),
			notes: [...new Set(notes)]
		}
	});
}

export const POST: RequestHandler = async (event) => {
	try {
		return await importDocument(event);
	} catch (cause) {
		const status = routeErrorStatus(cause);
		const message = routeErrorMessage(cause);
		if (status >= 500) console.error(cause);

		return json(
			{
				analysis: { notes: [message] },
				message
			},
			{ status }
		);
	}
};
