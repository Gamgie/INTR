import { base } from '$app/paths';

import {
	buildMonthlyStats,
	buildPeriodStats,
	buildTimelineMonths,
	calculateReference,
	currentMonthKey,
	estimateDailyAllowance,
	getActivePeriod,
	round
} from '$lib/stats';
import { appendFile } from '$lib/app/uploadFile';
import {
	ALL_YEARS,
	intermittenceYears,
	selectedIntermittenceYear,
	YEAR_PREFIX,
	type IntermittenceYear
} from '$lib/years';
import { defaultCompanyColor, normalizeCompanyColor } from '$lib/companyColors';
import type {
	AppData,
	Company,
	CompanySearchResult,
	CompanySuggestion,
	Contract,
	ContractDocument,
	ContractFields,
	ContractStatus,
	DocumentKind,
	FutureContract,
	MonthlyInfo,
	Project
} from '$lib/types';

export type Tab =
	| 'pilotage'
	| 'historique'
	| 'calendrier'
	| 'contrats'
	| 'structures'
	| 'stats'
	| 'intermittence';

export const tabs: { id: Tab; label: string }[] = [
	{ id: 'pilotage', label: 'Dashboard' },
	{ id: 'historique', label: 'Historique' },
	{ id: 'calendrier', label: 'Calendrier' },
	{ id: 'contrats', label: 'Contrats' },
	{ id: 'structures', label: 'Structures' },
	{ id: 'stats', label: 'Stats' },
	{ id: 'intermittence', label: 'Intermittence' }
];

export const statuses: ContractStatus[] = ['Estimation', 'Signé', 'Payé'];
export const documentKinds: DocumentKind[] = [
	'AEM',
	'Contrat',
	'Fiche de paie',
	'Congé Spectacle',
	'Déclaration Guso',
	'Autre'
];

function createLocalId(prefix: string) {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

type ServerPayloadFallback = {
	message?: string;
	analysis?: { notes?: string[] };
};

type DataMutationPayload = ServerPayloadFallback & {
	data?: AppData;
	deletedCount?: number;
};

type DocumentUploadPayload = {
	data?: AppData;
	companySuggestions: CompanySuggestion[];
	analysis: { notes: string[] };
	message?: string;
};

type DocumentImportPayload = DocumentUploadPayload & {
	createdContractId: string;
	routedContractId: string;
	documentIds: string[];
	periodIds: string[];
	appliedFields: Partial<ContractFields>;
};

export type ContractImportFeedbackItem = {
	fileName: string;
	status: 'success' | 'error';
	kind: string;
	destination: string;
	fields: string[];
	warnings: string[];
};

export type ContractImportFeedback = {
	phase: 'importing' | 'success' | 'partial' | 'error' | 'undoing' | 'undone';
	title: string;
	summary: string;
	processed: number;
	total: number;
	succeeded: number;
	failed: number;
	contractsCreated: number;
	contractUpdates: number;
	documentsAdded: number;
	unchangedFiles: number;
	periodsUpdated: number;
	items: ContractImportFeedbackItem[];
	canUndo: boolean;
};

type ContractImportUndoSnapshot = {
	data: AppData;
	activeTab: Tab;
	selectedCompanyId: string;
	selectedProjectId: string;
	selectedContractId: string;
	companySuggestions: CompanySuggestion[];
};

type AreNotificationPayload = {
	data?: AppData;
	period: { indemnizationStartDate: string };
	analysis: { notes: string[] };
	message?: string;
};

function textFromHtml(value: string) {
	return value
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function readServerPayload<T extends ServerPayloadFallback>(response: Response, fallback: T) {
	const raw = await response.text().catch(() => '');
	if (!raw.trim()) return fallback;

	try {
		return JSON.parse(raw) as T;
	} catch {
		const readable = textFromHtml(raw).slice(0, 180);
		const message = readable
			? `Réponse serveur illisible (${response.status}) : ${readable}`
			: `Réponse serveur illisible (${response.status}).`;

		return {
			...fallback,
			message,
			analysis: fallback.analysis ? { notes: [message] } : fallback.analysis
		} as T;
	}
}

function createCompany(name = 'Nouvelle structure'): Company {
	const id = createLocalId('company');

	return {
		id,
		name,
		legalName: '',
		contactName: '',
		email: '',
		phone: '',
		address: '',
		postalCode: '',
		city: '',
		siren: '',
		siret: '',
		ape: '',
		legalCategory: '',
		activityLabel: '',
		color: defaultCompanyColor(`${id}:${name}`),
		source: '',
		sourceUpdatedAt: '',
		notes: ''
	};
}

function createProject(companyId = ''): Project {
	return {
		id: createLocalId('project'),
		companyId,
		name: 'Nouveau projet',
		role: '',
		location: '',
		startDate: '',
		endDate: '',
		notes: ''
	};
}

function createContract(companyId = '', projectId = '', project?: Project): Contract {
	return {
		id: createLocalId('contract'),
		companyId: project?.companyId ?? companyId,
		projectId,
		title: 'Nouveau contrat',
		startDate: project?.startDate ?? '',
		endDate: project?.endDate ?? '',
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
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	};
}

export type IntrState = ReturnType<typeof createIntrState>;

export function createIntrState(initialData: AppData) {
	const initialSnapshot = structuredClone(initialData);
	const initialMonth = currentMonthKey();

	// L'app s'ouvre toujours sur l'année d'intermittence en cours, sauf choix explicite d'une
	// année (« year:2025 ») ou de toutes les années (« all »).
	const savedSelection = initialSnapshot.settings.activePeriodId;
	if (savedSelection !== ALL_YEARS && !savedSelection.startsWith(YEAR_PREFIX)) {
		initialSnapshot.settings.activePeriodId = '';
	}

	let appData = $state<AppData>(initialSnapshot);
	let activeTab = $state<Tab>('pilotage');
	let selectedCompanyId = $state(initialSnapshot.companies[0]?.id ?? '');
	let selectedProjectId = $state(initialSnapshot.projects[0]?.id ?? '');
	let selectedContractId = $state(initialSnapshot.contracts[0]?.id ?? '');
	let selectedMonth = $state(initialMonth);
	let companyEditId = $state('');
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error' | 'reloaded'>('idle');
	let uploadState = $state<Record<string, string>>({});
	let contractImportFeedback = $state<ContractImportFeedback | null>(null);
	let contractImportUndoSnapshot: ContractImportUndoSnapshot | undefined;
	let companySuggestionState = $state<CompanySuggestion[]>([]);
	let areUploadState = $state('');
	let cleanupFilesState = $state('');
	let deletingDocumentIds = $state<Record<string, boolean>>({});
	let syncState = $state<'idle' | 'checking' | 'blocked' | 'ready'>('idle');
	let dirty = $state(false);
	let changeRevision = $state(0);

	let activePeriod = $derived(getActivePeriod(appData));
	let selectedYear = $derived(selectedIntermittenceYear(appData));
	let years = $derived(intermittenceYears(appData));
	/** Notification ARE de l'année choisie, modifiable dans l'onglet Intermittence. */
	let activeNotification = $derived(selectedYear?.notification);
	let monthlyStats = $derived(buildMonthlyStats(appData));
	let periodStats = $derived(buildPeriodStats(appData));
	let timelineMonths = $derived(buildTimelineMonths(appData));
	let reference = $derived(calculateReference(appData));
	let dailyAllowance = $derived(estimateDailyAllowance(appData));
	let selectedContract = $derived(
		appData.contracts.find((contract) => contract.id === selectedContractId)
	);
	let selectedCompany = $derived(
		appData.companies.find((company) => company.id === selectedCompanyId)
	);
	let selectedProject = $derived(
		appData.projects.find((project) => project.id === selectedProjectId)
	);
	let selectedMonthInfo = $derived(
		appData.monthlyInfos.find(
			(info) =>
				info.month === selectedMonth &&
				(!appData.settings.activePeriodId || info.periodId === appData.settings.activePeriodId)
		)
	);
	let selectedMonthStats = $derived(
		monthlyStats.find((stats) => stats.month === selectedMonth) ?? monthlyStats[0]
	);
	let recentContracts = $derived(
		[...appData.contracts]
			.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
			.slice(0, 8)
	);
	let totalNet = $derived(monthlyStats.reduce((total, stats) => total + stats.netSalary, 0));
	let totalGross = $derived(monthlyStats.reduce((total, stats) => total + stats.grossSalary, 0));
	let totalEmployerCost = $derived(
		monthlyStats.reduce((total, stats) => total + stats.employerCost, 0)
	);
	let totalContributions = $derived(
		monthlyStats.reduce((total, stats) => total + stats.contributions, 0)
	);

	function touch() {
		if (contractImportUndoSnapshot && contractImportFeedback?.canUndo) {
			contractImportUndoSnapshot = undefined;
			contractImportFeedback = { ...contractImportFeedback, canUndo: false };
		}
		changeRevision += 1;
		dirty = true;
		if (saveState === 'saved' || saveState === 'error' || saveState === 'reloaded') saveState = 'idle';
	}

	function ensureMonthlyInfo(month: string): MonthlyInfo {
		const periodId = appData.settings.activePeriodId;
		let info = appData.monthlyInfos.find(
			(item) => item.month === month && (!periodId || item.periodId === periodId)
		);

		if (!info) {
			info = {
				month,
				periodId,
				congeSpectacle: 0,
				realIndemnity: 0,
				dailyIndemnity: 0,
				notes: ''
			};
			appData.monthlyInfos.push(info);
		}

		return info;
	}

	// periodId : '' (année en cours), 'year:AAAA' ou 'all'. L'AJ minimale n'est plus remplacée
	// par l'AJ notifiée : l'AJ notifiée vient directement de la notification de l'année.
	function selectPeriod(periodId: string) {
		appData.settings.activePeriodId = periodId;
		const year = selectedIntermittenceYear(appData);
		if (year && !isMonthInYear(selectedMonth, year)) {
			const today = currentMonthKey();
			selectedMonth = isMonthInYear(today, year) ? today : year.end.slice(0, 7);
		}
		touch();
	}

	function isMonthInYear(month: string, year: IntermittenceYear) {
		return month >= year.start.slice(0, 7) && month <= year.end.slice(0, 7);
	}

	function companyName(id: string) {
		return appData.companies.find((company) => company.id === id)?.name || 'Sans structure';
	}

	function projectName(id: string) {
		return appData.projects.find((project) => project.id === id)?.name || 'Sans projet';
	}

	function companyColor(id: string) {
		const company = appData.companies.find((item) => item.id === id);
		return normalizeCompanyColor(company?.color ?? '', `${id}:${company?.name ?? ''}`);
	}

	function normalizeDigits(value: string) {
		return value.replace(/\D/g, '');
	}

	function documentsFor(contract: Contract) {
		return contract.documentIds
			.map((id) => appData.documents.find((document) => document.id === id))
			.filter(Boolean) as ContractDocument[];
	}

	function selectMonth(month: string) {
		selectedMonth = month;
		ensureMonthlyInfo(month);
	}

	async function saveData(revision = changeRevision) {
		if (saveState === 'saving') return;

		const body = JSON.stringify(appData);
		saveState = 'saving';

		try {
			const response = await fetch(`${base}/api/data`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body
			});

			if (response.status === 409) {
				// Données plus récentes sur le serveur : on les reprend plutôt que de les écraser.
				const payload = (await response.json().catch(() => ({}))) as { data?: AppData };
				if (payload.data) appData = payload.data;
				dirty = false;
				saveState = 'reloaded';
				return;
			}

			if (!response.ok) {
				saveState = 'error';
				return;
			}

			const savedData = await response.json();
			if (changeRevision === revision) {
				appData = savedData;
				dirty = false;
				saveState = 'saved';
				return;
			}

			// Modifiée pendant l'envoi : on garde la saisie, avec la date de la version enregistrée.
			appData.updatedAt = savedData.updatedAt;
			dirty = true;
			saveState = 'idle';
		} catch {
			saveState = 'error';
		}
	}

	function addCompany(name = 'Nouvelle structure') {
		const company = createCompany(name);
		appData.companies.unshift(company);
		selectedCompanyId = company.id;
		companyEditId = company.id;
		activeTab = 'structures';
		touch();
	}

	function fillCompanyFromSearchResult(company: Company, result: CompanySearchResult) {
		company.name = result.name;
		company.legalName = result.legalName;
		company.address = result.address;
		company.postalCode = result.postalCode;
		company.city = result.city;
		company.siren = result.siren;
		company.siret = result.siret;
		company.ape = result.ape;
		company.legalCategory = result.legalCategory;
		company.activityLabel = result.activityLabel;
		company.color = normalizeCompanyColor(company.color, `${company.id}:${company.name}`);
		company.source = result.sourceUrl;
		company.sourceUpdatedAt = result.sourceUpdatedAt;
	}

	function applyCompanySearchResult(company: Company, result: CompanySearchResult) {
		fillCompanyFromSearchResult(company, result);
		touch();
	}

	function mergeCompanySuggestions(suggestions: CompanySuggestion[] = []) {
		if (!suggestions.length) return;

		const knownSirets = new Set(appData.companies.map((company) => normalizeDigits(company.siret)));
		const byKey = new Map(
			companySuggestionState.map((suggestion) => [
				`${suggestion.contractId}:${suggestion.siret}`,
				suggestion
			])
		);

		for (const suggestion of suggestions) {
			if (knownSirets.has(normalizeDigits(suggestion.result.siret || suggestion.siret))) continue;
			byKey.set(`${suggestion.contractId}:${suggestion.siret}`, suggestion);
		}

		companySuggestionState = [...byKey.values()];
	}

	function dismissCompanySuggestion(suggestion: CompanySuggestion) {
		companySuggestionState = companySuggestionState.filter(
			(item) => item.contractId !== suggestion.contractId || item.siret !== suggestion.siret
		);
	}

	function applyCompanySuggestion(suggestion: CompanySuggestion) {
		const resultSiret = normalizeDigits(suggestion.result.siret || suggestion.siret);
		const resultSiren = normalizeDigits(suggestion.result.siren);
		let company = appData.companies.find(
			(item) =>
				(resultSiret && normalizeDigits(item.siret) === resultSiret) ||
				(resultSiren && normalizeDigits(item.siren) === resultSiren)
		);

		if (!company) {
			company = createCompany(suggestion.result.name);
			appData.companies.unshift(company);
		}

		fillCompanyFromSearchResult(company, suggestion.result);

		const contract = appData.contracts.find((item) => item.id === suggestion.contractId);
		if (contract) {
			contract.companyId = company.id;
			const project = appData.projects.find((item) => item.id === contract.projectId);
			if (project && project.companyId !== company.id) contract.projectId = '';
			contract.updatedAt = new Date().toISOString();
		}

		for (const document of appData.documents) {
			if (document.contractId === suggestion.contractId && !document.extractedFields.companyId) {
				document.extractedFields.companyId = company.id;
			}
		}

		selectedCompanyId = company.id;
		selectedContractId = suggestion.contractId || selectedContractId;
		companySuggestionState = companySuggestionState.filter(
			(item) => item.contractId !== suggestion.contractId || item.siret !== suggestion.siret
		);
		touch();
	}

	function removeCompany(company: Company) {
		if (!window.confirm(`Supprimer ${company.name} ? Les projets et contrats seront conservés.`)) {
			return;
		}

		appData.companies = appData.companies.filter((item) => item.id !== company.id);
		for (const project of appData.projects) {
			if (project.companyId === company.id) project.companyId = '';
		}
		for (const contract of appData.contracts) {
			if (contract.companyId === company.id) contract.companyId = '';
		}
		selectedCompanyId = appData.companies[0]?.id ?? '';
		if (companyEditId === company.id) companyEditId = '';
		touch();
	}

	function addProject(companyId = selectedCompanyId) {
		const project = createProject(companyId);
		appData.projects.unshift(project);
		selectedProjectId = project.id;
		activeTab = 'structures';
		touch();
	}

	async function removeProject(project: Project) {
		if (
			!window.confirm(`Supprimer le projet ${project.name}, ses contrats liés et leurs documents ?`)
		) {
			return;
		}

		try {
			const response = await fetch(`${base}/api/projects/${encodeURIComponent(project.id)}`, {
				method: 'DELETE'
			});
			const payload = await readServerPayload<DataMutationPayload>(response, {
				message: 'Réponse serveur illisible.'
			});

			if (!response.ok || !payload.data) {
				window.alert(payload.message ?? 'Suppression du projet impossible.');
				return;
			}

			appData = payload.data;
			selectedProjectId = appData.projects[0]?.id ?? '';
			selectedContractId = appData.contracts[0]?.id ?? '';
			cleanupFilesState = `${payload.deletedCount ?? 0} fichier(s) supprimé(s) avec le projet.`;
			dirty = false;
			saveState = 'saved';
		} catch {
			window.alert('Erreur réseau pendant la suppression du projet.');
		}
	}

	function addContract(projectId = selectedProjectId) {
		const project = appData.projects.find((item) => item.id === projectId);
		const contract = createContract(selectedCompanyId, projectId, project);
		appData.contracts.unshift(contract);
		selectedContractId = contract.id;
		contractImportFeedback = null;
		contractImportUndoSnapshot = undefined;
		activeTab = 'contrats';
		touch();
	}

	function removeContract(contract: Contract) {
		if (!window.confirm(`Supprimer le contrat ${contract.title} `)) return;
		appData.contracts = appData.contracts.filter((item) => item.id !== contract.id);
		appData.documents = appData.documents.filter((document) => document.contractId !== contract.id);
		selectedContractId = appData.contracts[0]?.id ?? '';
		touch();
	}

	function updateRates(contract: Contract) {
		if (contract.hours > 0) {
			contract.netHourlyRate = round(contract.netSalary / contract.hours);
			contract.grossHourlyRate = round(contract.grossSalary / contract.hours);
		}

		if (!contract.contributions && contract.grossSalary && contract.netSalary) {
			contract.contributions = round(contract.grossSalary - contract.netSalary);
		}

		contract.updatedAt = new Date().toISOString();
		touch();
	}

	function setStatus(contract: Contract, status: ContractStatus) {
		contract.status = status;
		contract.updatedAt = new Date().toISOString();
		touch();
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

		if (documents.some((document) => document.kind === 'Contrat')) return 'Signé';
		return undefined;
	}

	function changeDocumentKind(document: ContractDocument, kind: DocumentKind) {
		if (document.kind === kind) return;

		document.kind = kind;
		const contract = appData.contracts.find((item) => item.id === document.contractId);

		if (contract) {
			const nextStatus = statusFromDocuments(documentsFor(contract));
			if (nextStatus) contract.status = nextStatus;
			contract.updatedAt = new Date().toISOString();
		}

		touch();
	}

	async function removeDocument(document: ContractDocument) {
		if (!window.confirm(`Supprimer définitivement le document « ${document.fileName} » ?`)) return;

		deletingDocumentIds[document.id] = true;

		try {
			const response = await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}`, {
				method: 'DELETE'
			});
			const payload = await readServerPayload<DataMutationPayload>(response, {
				message: 'Réponse serveur illisible.'
			});

			if (!response.ok || !payload.data) {
				window.alert(payload.message ?? 'Suppression du document impossible.');
				return;
			}

			appData.documents = appData.documents.filter((item) => item.id !== document.id);
			for (const contract of appData.contracts) {
				if (!contract.documentIds.includes(document.id)) continue;

				contract.documentIds = contract.documentIds.filter((id) => id !== document.id);
				contract.updatedAt = new Date().toISOString();
			}
			touch();
		} catch {
			window.alert('Erreur réseau pendant la suppression du document.');
		} finally {
			delete deletingDocumentIds[document.id];
		}
	}

	function applyFields(contract: Contract, fields: Partial<ContractFields>) {
		for (const [key, value] of Object.entries(fields) as [
			keyof ContractFields,
			ContractFields[keyof ContractFields]
		][]) {
			(contract[key] as ContractFields[keyof ContractFields]) = value;
		}
		updateRates(contract);
	}

	async function uploadDocument(contract: Contract, event: Event, kind: DocumentKind) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploadState[contract.id] = 'Analyse...';

		const body = new FormData();
		body.set('contractId', contract.id);
		body.set('autoRoute', 'true');
		body.set('kind', kind);
		await appendFile(body, file);

		const response = await fetch(`${base}/api/documents`, { method: 'POST', body });
		input.value = '';
		const payload = await readServerPayload<DocumentUploadPayload>(response, {
			analysis: { notes: ['Réponse serveur illisible.'] },
			companySuggestions: [],
			message: 'Réponse serveur illisible.'
		});

		if (!response.ok || !payload.data) {
			uploadState[contract.id] = payload.message ?? 'Erreur upload.';
			return;
		}

		appData = payload.data;
		mergeCompanySuggestions(payload.companySuggestions);
		dirty = false;
		saveState = 'saved';
		uploadState[contract.id] = `${file.name} importé et analysé.`;
	}

	function importFieldLabels(fields: Partial<ContractFields>) {
		const labels: string[] = [];
		const format = (value: number) =>
			new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);

		if (fields.hours !== undefined) labels.push(`${format(fields.hours)} h`);
		if (fields.cachets) labels.push(`${format(fields.cachets)} cachet(s)`);
		if (fields.grossSalary) labels.push(`${format(fields.grossSalary)} € brut`);
		if (fields.netSalary) labels.push(`${format(fields.netSalary)} € net`);
		if (fields.taxableNetSalary) {
			labels.push(`${format(fields.taxableNetSalary)} € net imposable`);
		}
		if (fields.contributions) labels.push(`${format(fields.contributions)} € cotisations`);
		if (fields.netHourlyRate) labels.push(`${format(fields.netHourlyRate)} €/h net`);

		return labels.slice(0, 6);
	}

	function usefulImportWarnings(notes: string[]) {
		return [
			...new Set(
				notes.filter((note) =>
					/doublon|conflit|inconnue|aucun (?:texte|champ)|découpé|indisponible/i.test(note)
				)
			)
		].slice(0, 2);
	}

	function dismissContractImportFeedback() {
		contractImportFeedback = null;
		contractImportUndoSnapshot = undefined;
	}

	async function createContractFromDocument(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (!files.length) return;

		const undoSnapshot: ContractImportUndoSnapshot = {
			data: $state.snapshot(appData),
			activeTab,
			selectedCompanyId,
			selectedProjectId,
			selectedContractId,
			companySuggestions: $state.snapshot(companySuggestionState)
		};
		contractImportUndoSnapshot = undefined;
		contractImportFeedback = {
			phase: 'importing',
			title: 'Import en cours',
			summary:
				files.length === 1
					? `Analyse de ${files[0].name}`
					: `Analyse et classement de ${files.length} documents`,
			processed: 0,
			total: files.length,
			succeeded: 0,
			failed: 0,
			contractsCreated: 0,
			contractUpdates: 0,
			documentsAdded: 0,
			unchangedFiles: 0,
			periodsUpdated: 0,
			items: [],
			canUndo: false
		};

		let importedCount = 0;
		let contractsCreated = 0;
		let contractUpdates = 0;
		let documentsAdded = 0;
		let unchangedFiles = 0;
		let periodsUpdated = 0;
		let lastRoutedContractId = '';
		let sawPeriodImport = false;
		const items: ContractImportFeedbackItem[] = [];

		for (const [index, file] of files.entries()) {
			contractImportFeedback = {
				...contractImportFeedback!,
				summary: `Analyse de ${file.name}`,
				processed: index,
				items: [...items]
			};

			const body = new FormData();
			body.set('autoRoute', 'true');
			body.set('kind', 'Autre');

			let response: Response;
			let payload: DocumentImportPayload;

			try {
				await appendFile(body, file);
				response = await fetch(`${base}/api/documents`, { method: 'POST', body });
				payload = await readServerPayload<DocumentImportPayload>(response, {
					analysis: { notes: ['Réponse serveur illisible.'] },
					appliedFields: {},
					companySuggestions: [],
					createdContractId: '',
					documentIds: [],
					message: 'Réponse serveur illisible.',
					periodIds: [],
					routedContractId: ''
				});
			} catch {
				items.push({
					fileName: file.name,
					status: 'error',
					kind: 'Échec',
					destination: 'Erreur réseau pendant l’import.',
					fields: [],
					warnings: []
				});
				continue;
			}

			if (!response.ok) {
				items.push({
					fileName: file.name,
					status: 'error',
					kind: 'Échec',
					destination: payload.message ?? 'Erreur pendant l’import.',
					fields: [],
					warnings: []
				});
				continue;
			}

			if (!payload.data) {
				items.push({
					fileName: file.name,
					status: 'error',
					kind: 'Échec',
					destination: 'Réponse serveur incomplète.',
					fields: [],
					warnings: []
				});
				continue;
			}

			importedCount += 1;
			appData = payload.data;
			mergeCompanySuggestions(payload.companySuggestions);

			const routedContractId = payload.routedContractId || payload.createdContractId || '';
			const addedDocumentCount = (payload.documentIds ?? []).length;
			const hasAppliedFields = Object.keys(payload.appliedFields ?? {}).length > 0;
			documentsAdded += addedDocumentCount;
			periodsUpdated += (payload.periodIds ?? []).length;
			if (payload.createdContractId) contractsCreated += 1;
			else if (routedContractId && (addedDocumentCount > 0 || hasAppliedFields))
				contractUpdates += 1;
			else if (routedContractId) unchangedFiles += 1;
			if (routedContractId) {
				lastRoutedContractId = routedContractId;
				uploadState[routedContractId] = payload.createdContractId
					? 'Contrat créé et documents classés automatiquement.'
					: `${file.name} classé automatiquement.`;
			}

			if ((payload.periodIds ?? []).length) sawPeriodImport = true;

			const importedDocuments = payload.data.documents.filter((document) =>
				(payload.documentIds ?? []).includes(document.id)
			);
			const kinds = [...new Set(importedDocuments.map((document) => document.kind))];
			const detectedFields = Object.assign(
				{},
				...importedDocuments.map((document) => document.extractedFields),
				payload.appliedFields ?? {}
			) as Partial<ContractFields>;
			const routedContract = payload.data.contracts.find(
				(contract) => contract.id === routedContractId
			);
			items.push({
				fileName: file.name,
				status: 'success',
				kind:
					kinds.join(' + ') || ((payload.periodIds ?? []).length ? 'Notification ARE' : 'Document'),
				destination: routedContract
					? `${
							payload.createdContractId
								? 'Contrat créé'
								: addedDocumentCount > 0 || hasAppliedFields
									? 'Contrat mis à jour'
									: 'Contrat inchangé'
						} · ${routedContract.title}`
					: 'Intermittence mise à jour',
				fields: importFieldLabels(detectedFields),
				warnings: usefulImportWarnings(payload.analysis.notes ?? [])
			});
		}

		input.value = '';

		if (lastRoutedContractId) {
			selectedContractId = lastRoutedContractId;
			activeTab = 'contrats';
		} else if (sawPeriodImport) {
			activeTab = 'intermittence';
		}

		if (importedCount > 0) {
			dirty = false;
			saveState = 'saved';
		}

		const failedCount = files.length - importedCount;
		contractImportUndoSnapshot = importedCount > 0 ? undoSnapshot : undefined;
		contractImportFeedback = {
			phase: importedCount === 0 ? 'error' : failedCount > 0 ? 'partial' : 'success',
			title:
				importedCount === 0
					? 'Import impossible'
					: `${importedCount} fichier${importedCount > 1 ? 's traités' : ' traité'}`,
			summary:
				failedCount === 0
					? 'Tous les fichiers ont été analysés et classés automatiquement.'
					: `${failedCount} fichier${failedCount > 1 ? 's n’ont' : ' n’a'} pas pu être importé${failedCount > 1 ? 's' : ''}.`,
			processed: files.length,
			total: files.length,
			succeeded: importedCount,
			failed: failedCount,
			contractsCreated,
			contractUpdates,
			documentsAdded,
			unchangedFiles,
			periodsUpdated,
			items,
			canUndo: importedCount > 0
		};
	}

	async function undoContractImport() {
		const snapshot = contractImportUndoSnapshot;
		const previousFeedback = contractImportFeedback;
		if (!snapshot || !previousFeedback?.canUndo) return;

		contractImportFeedback = {
			...previousFeedback,
			phase: 'undoing',
			title: 'Annulation en cours',
			summary: 'Restauration de la situation avant import…',
			canUndo: false
		};

		try {
			const response = await fetch(`${base}/api/data`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json', 'x-intr-force': '1' },
				body: JSON.stringify(snapshot.data)
			});
			if (!response.ok) throw new Error('Restauration refusée par le serveur.');

			appData = (await response.json()) as AppData;
			try {
				const cleanupResponse = await fetch(`${base}/api/maintenance/cleanup`, { method: 'POST' });
				const cleanupPayload = await readServerPayload<DataMutationPayload>(cleanupResponse, {});
				if (cleanupResponse.ok && cleanupPayload.data) appData = cleanupPayload.data;
			} catch {
				// Les données sont déjà restaurées ; le nettoyage pourra être relancé plus tard.
			}

			activeTab = snapshot.activeTab;
			selectedCompanyId = appData.companies.some(
				(company) => company.id === snapshot.selectedCompanyId
			)
				? snapshot.selectedCompanyId
				: (appData.companies[0]?.id ?? '');
			selectedProjectId = appData.projects.some(
				(project) => project.id === snapshot.selectedProjectId
			)
				? snapshot.selectedProjectId
				: (appData.projects[0]?.id ?? '');
			selectedContractId = appData.contracts.some(
				(contract) => contract.id === snapshot.selectedContractId
			)
				? snapshot.selectedContractId
				: (appData.contracts[0]?.id ?? '');
			companySuggestionState = structuredClone(snapshot.companySuggestions);
			uploadState = {};
			dirty = false;
			saveState = 'saved';
			changeRevision += 1;
			contractImportUndoSnapshot = undefined;
			contractImportFeedback = {
				phase: 'undone',
				title: 'Import annulé',
				summary: 'Les documents et les modifications associées ont été retirés.',
				processed: previousFeedback.total,
				total: previousFeedback.total,
				succeeded: 0,
				failed: 0,
				contractsCreated: 0,
				contractUpdates: 0,
				documentsAdded: 0,
				unchangedFiles: 0,
				periodsUpdated: 0,
				items: [],
				canUndo: false
			};
		} catch {
			contractImportFeedback = {
				...previousFeedback,
				phase: 'error',
				title: 'Annulation impossible',
				summary: 'Le serveur n’a pas pu restaurer les données. Vous pouvez réessayer.',
				canUndo: true
			};
		}
	}

	async function cleanupUnusedFiles() {
		cleanupFilesState = 'Nettoyage des fichiers non utilisés...';

		try {
			const response = await fetch(`${base}/api/maintenance/cleanup`, { method: 'POST' });
			const payload = await readServerPayload<DataMutationPayload>(response, {
				message: 'Réponse serveur illisible.'
			});

			if (!response.ok || !payload.data) {
				cleanupFilesState = payload.message ?? 'Nettoyage impossible.';
				return;
			}

			appData = payload.data;
			dirty = false;
			saveState = 'saved';
			cleanupFilesState = `${payload.deletedCount ?? 0} fichier(s) non utilisé(s) supprimé(s).`;
		} catch {
			cleanupFilesState = 'Erreur réseau pendant le nettoyage.';
		}
	}

	async function uploadAreNotification(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		areUploadState = 'Analyse de la notification ARE...';

		const body = new FormData();
		await appendFile(body, file);

		const response = await fetch(`${base}/api/are/notifications`, { method: 'POST', body });
		input.value = '';
		const payload = await readServerPayload<AreNotificationPayload>(response, {
			analysis: { notes: ['Réponse serveur illisible.'] },
			period: { indemnizationStartDate: '' },
			message: 'Réponse serveur illisible.'
		});

		if (!response.ok || !payload.data) {
			areUploadState = payload.message ?? 'Erreur pendant l’analyse de la notification ARE.';
			return;
		}

		appData = payload.data;
		if (payload.period.indemnizationStartDate) {
			selectedMonth = payload.period.indemnizationStartDate.slice(0, 7);
			ensureMonthlyInfo(selectedMonth);
			await saveData();
		} else {
			dirty = false;
			saveState = 'saved';
		}
		areUploadState = payload.analysis.notes.join(' ');
	}

	async function removePeriod(periodId: string) {
		const period = appData.periods.find((item) => item.id === periodId);
		if (!period) return;
		if (!window.confirm(`Supprimer la notification ARE "${period.label}" `)) return;

		areUploadState = 'Suppression de la notification ARE...';

		try {
			const response = await fetch(`${base}/api/periods/${encodeURIComponent(periodId)}`, {
				method: 'DELETE'
			});
			const payload = await readServerPayload<DataMutationPayload>(response, {
				message: 'Réponse serveur illisible.'
			});

			if (!response.ok || !payload.data) {
				areUploadState = payload.message ?? 'Suppression ARE impossible.';
				return;
			}

			appData = payload.data;
			selectedMonth = currentMonthKey();
			ensureMonthlyInfo(selectedMonth);
			dirty = false;
			saveState = 'saved';
			areUploadState = `${payload.deletedCount ?? 0} fichier(s) supprimé(s) avec la notification ARE.`;
		} catch {
			areUploadState = 'Erreur réseau pendant la suppression ARE.';
		}
	}

	function addFutureContract() {
		const future: FutureContract = {
			id: createLocalId('future'),
			companyName: selectedCompany?.name ?? '',
			amount: 0,
			amountType: 'gross',
			estimatedHours: 0,
			notes: ''
		};

		appData.futureContracts.unshift(future);
		activeTab = 'intermittence';
		touch();
	}

	function removeFutureContract(future: FutureContract) {
		appData.futureContracts = appData.futureContracts.filter((item) => item.id !== future.id);
		touch();
	}

	async function checkGhsSync() {
		syncState = 'checking';

		const response = await fetch(`${base}/api/transat/sync`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(appData.settings)
		});
		const payload = await response.json();

		appData.settings.ghsLastSyncAt = new Date().toISOString();
		appData.settings.ghsLastSyncStatus = payload.message;
		syncState = response.ok ? 'ready' : 'blocked';
		touch();
	}

	ensureMonthlyInfo(initialMonth);

	return {
		get appData() {
			return appData;
		},
		set appData(value: AppData) {
			appData = value;
		},
		get activeTab() {
			return activeTab;
		},
		set activeTab(value: Tab) {
			activeTab = value;
		},
		get selectedCompanyId() {
			return selectedCompanyId;
		},
		set selectedCompanyId(value: string) {
			selectedCompanyId = value;
		},
		get selectedProjectId() {
			return selectedProjectId;
		},
		set selectedProjectId(value: string) {
			selectedProjectId = value;
		},
		get selectedContractId() {
			return selectedContractId;
		},
		set selectedContractId(value: string) {
			selectedContractId = value;
		},
		get selectedMonth() {
			return selectedMonth;
		},
		set selectedMonth(value: string) {
			selectedMonth = value;
		},
		get companyEditId() {
			return companyEditId;
		},
		set companyEditId(value: string) {
			companyEditId = value;
		},
		get saveState() {
			return saveState;
		},
		get uploadState() {
			return uploadState;
		},
		get contractImportFeedback() {
			return contractImportFeedback;
		},
		get companySuggestionState() {
			return companySuggestionState;
		},
		get syncState() {
			return syncState;
		},
		get areUploadState() {
			return areUploadState;
		},
		get cleanupFilesState() {
			return cleanupFilesState;
		},
		get deletingDocumentIds() {
			return deletingDocumentIds;
		},
		get dirty() {
			return dirty;
		},
		get changeRevision() {
			return changeRevision;
		},
		get selectedYear() {
			return selectedYear;
		},
		get years() {
			return years;
		},
		get activeNotification() {
			return activeNotification;
		},
		get activePeriod() {
			return activePeriod;
		},
		get monthlyStats() {
			return monthlyStats;
		},
		get periodStats() {
			return periodStats;
		},
		get timelineMonths() {
			return timelineMonths;
		},
		get reference() {
			return reference;
		},
		get dailyAllowance() {
			return dailyAllowance;
		},
		get selectedContract() {
			return selectedContract;
		},
		get selectedCompany() {
			return selectedCompany;
		},
		get selectedProject() {
			return selectedProject;
		},
		get selectedMonthInfo() {
			return selectedMonthInfo;
		},
		get selectedMonthStats() {
			return selectedMonthStats;
		},
		get recentContracts() {
			return recentContracts;
		},
		get totalNet() {
			return totalNet;
		},
		get totalGross() {
			return totalGross;
		},
		get totalEmployerCost() {
			return totalEmployerCost;
		},
		get totalContributions() {
			return totalContributions;
		},
		touch,
		companyName,
		projectName,
		companyColor,
		documentsFor,
		selectMonth,
		selectPeriod,
		saveData,
		addCompany,
		applyCompanySearchResult,
		applyCompanySuggestion,
		dismissCompanySuggestion,
		removeCompany,
		addProject,
		removeProject,
		addContract,
		removeContract,
		updateRates,
		setStatus,
		changeDocumentKind,
		removeDocument,
		applyFields,
		uploadDocument,
		createContractFromDocument,
		undoContractImport,
		dismissContractImportFeedback,
		cleanupUnusedFiles,
		uploadAreNotification,
		removePeriod,
		addFutureContract,
		removeFutureContract,
		checkGhsSync
	};
}
