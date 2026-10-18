import { defaultCompanyColor, normalizeCompanyColor } from '$lib/companyColors';
import type {
	AppData,
	Company,
	Contract,
	ContractFields,
	FutureContract,
	FutureContractAmountType,
	IntermittencePeriod,
	MonthlyInfo,
	Project
} from '$lib/types';

import { normalizeAnnex } from '$lib/rules';
import { persistence } from '$lib/server/persistence';

export { dataDir, documentDir } from '$lib/server/persistence';

const now = () => new Date().toISOString();

export function createId(prefix: string) {
	return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyContractFields(): ContractFields {
	return {
		companyId: '',
		projectId: '',
		title: '',
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
		notes: ''
	};
}

export function createDefaultData(): AppData {
	return {
		version: 1,
		updatedAt: now(),
		companies: [
			{
				id: createId('company'),
				name: 'Compagnie exemple',
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
				color: defaultCompanyColor('Compagnie exemple'),
				source: '',
				sourceUpdatedAt: '',
				notes: 'Remplace cette fiche par tes vraies structures.'
			}
		],
		projects: [],
		contracts: [],
		documents: [],
		periods: [],
		futureContracts: [],
		monthlyInfos: [],
		settings: {
			referenceStartDate: `${new Date().getFullYear()}-01-01`,
			targetHours: 507,
			annex: 'Annexe 8',
			minDailyAllowance: 31.96,
			smicHourlyGross: 12.31,
			annex8SalaryCoefficient: 0.42,
			annex8HoursCoefficient: 0.26,
			annex8FixedCoefficient: 0.4,
			monthlyWorkDayDivisor: 8,
			monthlyShiftCoefficient: 1.4,
			pmss: 4005,
			cumulPmssMultiplier: 1.18,
			transatEmail: '',
			ghsApiBaseUrl: '',
			ghsApiToken: '',
			ghsSyncEnabled: false,
			ghsLastSyncAt: '',
			ghsLastSyncStatus: 'Connecteur non configuré',
			activePeriodId: '',
			remoteBaseUrl: 'https://yoursite.fr/intermittens',
			remoteSyncEnabled: false,
			remoteLastSyncAt: '',
			remoteLastSyncStatus: 'Synchronisation distante non activée'
		}
	};
}

function normalizeNumber(value: unknown) {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function cleanString(value: unknown) {
	return typeof value === 'string' ? value : '';
}

function normalizeFutureContractAmountType(value: unknown): FutureContractAmountType {
	const amountType = cleanString(value);

	return amountType === 'employerCost' || amountType === 'gross' || amountType === 'net'
		? amountType
		: 'gross';
}

function normalizeCompany(company: Partial<Company>): Company {
	const id = cleanString(company.id) || createId('company');
	const name = cleanString(company.name) || 'Nouvelle structure';

	return {
		id,
		name,
		legalName: cleanString(company.legalName),
		contactName: cleanString(company.contactName),
		email: cleanString(company.email),
		phone: cleanString(company.phone),
		address: cleanString(company.address),
		postalCode: cleanString(company.postalCode),
		city: cleanString(company.city),
		siren: cleanString(company.siren),
		siret: cleanString(company.siret),
		ape: cleanString(company.ape),
		legalCategory: cleanString(company.legalCategory),
		activityLabel: cleanString(company.activityLabel),
		color: normalizeCompanyColor(cleanString(company.color), `${id}:${name}`),
		source: cleanString(company.source),
		sourceUpdatedAt: cleanString(company.sourceUpdatedAt),
		notes: cleanString(company.notes)
	};
}

function normalizeProject(project: Partial<Project>): Project {
	return {
		id: cleanString(project.id) || createId('project'),
		companyId: cleanString(project.companyId),
		name: cleanString(project.name) || 'Nouveau projet',
		role: cleanString(project.role),
		location: cleanString(project.location),
		startDate: cleanString(project.startDate),
		endDate: cleanString(project.endDate),
		notes: cleanString(project.notes)
	};
}

function normalizeContract(contract: Partial<Contract>): Contract {
	const fields = emptyContractFields();
	const createdAt = cleanString(contract.createdAt) || now();
	const updatedAt = cleanString(contract.updatedAt) || now();
	const status = cleanString(contract.status);

	return {
		id: cleanString(contract.id) || createId('contract'),
		companyId: cleanString(contract.companyId),
		projectId: cleanString(contract.projectId),
		title: cleanString(contract.title) || 'Nouveau contrat',
		startDate: cleanString(contract.startDate),
		endDate: cleanString(contract.endDate),
		hours: normalizeNumber(contract.hours),
		cachets: normalizeNumber(contract.cachets),
		employmentStatus: cleanString(contract.employmentStatus),
		netSalary: normalizeNumber(contract.netSalary),
		taxableNetSalary: normalizeNumber(contract.taxableNetSalary),
		grossSalary: normalizeNumber(contract.grossSalary),
		contributions: normalizeNumber(contract.contributions),
		netHourlyRate: normalizeNumber(contract.netHourlyRate || fields.netHourlyRate),
		grossHourlyRate: normalizeNumber(contract.grossHourlyRate || fields.grossHourlyRate),
		status:
			status === 'Signé' || status === 'Signe'
				? 'Signé'
				: status === 'Payé' || status === 'Paye'
					? 'Payé'
					: status === 'Estimation'
						? 'Estimation'
						: 'Estimation',
		notes: cleanString(contract.notes),
		documentIds: Array.isArray(contract.documentIds) ? contract.documentIds.map(String) : [],
		createdAt,
		updatedAt
	};
}

function normalizeFutureContract(future: Partial<FutureContract>): FutureContract {
	const legacy = future as Partial<FutureContract> & {
		label?: unknown;
		expectedHours?: unknown;
		expectedGrossSalary?: unknown;
	};

	return {
		id: cleanString(future.id) || createId('future'),
		companyName: cleanString(future.companyName) || cleanString(legacy.label),
		amount: normalizeNumber(future.amount ?? legacy.expectedGrossSalary),
		amountType: normalizeFutureContractAmountType(future.amountType),
		estimatedHours: normalizeNumber(future.estimatedHours ?? legacy.expectedHours),
		notes: cleanString(future.notes)
	};
}

function normalizePeriod(period: Partial<IntermittencePeriod>): IntermittencePeriod {
	const createdAt = cleanString(period.createdAt) || now();
	const updatedAt = cleanString(period.updatedAt) || now();

	return {
		id: cleanString(period.id) || createId('period'),
		label: cleanString(period.label) || 'Période intermittence',
		status:
			period.status === 'Notifie' || period.status === 'Archive' || period.status === 'Estimation'
				? period.status
				: 'Estimation',
		admissionDate: cleanString(period.admissionDate),
		indemnizationStartDate: cleanString(period.indemnizationStartDate),
		anniversaryDate: cleanString(period.anniversaryDate),
		referenceStartDate: cleanString(period.referenceStartDate),
		referenceEndDate: cleanString(period.referenceEndDate),
		hours: normalizeNumber(period.hours),
		cachets: normalizeNumber(period.cachets),
		grossSalary: normalizeNumber(period.grossSalary),
		dailyAllowance: normalizeNumber(period.dailyAllowance),
		waitingDays: normalizeNumber(period.waitingDays),
		salaryFranchiseDays: normalizeNumber(period.salaryFranchiseDays),
		congeFranchiseDays: normalizeNumber(period.congeFranchiseDays),
		sourceFileName: cleanString(period.sourceFileName),
		sourceStoredName: cleanString(period.sourceStoredName),
		sourceTextPreview: cleanString(period.sourceTextPreview),
		analysisNotes: Array.isArray(period.analysisNotes) ? period.analysisNotes.map(String) : [],
		createdAt,
		updatedAt,
		notes: cleanString(period.notes)
	};
}

function normalizeMonthlyInfo(info: Partial<MonthlyInfo>): MonthlyInfo {
	return {
		month: cleanString(info.month),
		periodId: cleanString(info.periodId),
		congeSpectacle: normalizeNumber(info.congeSpectacle),
		realIndemnity: normalizeNumber(info.realIndemnity),
		dailyIndemnity: normalizeNumber(info.dailyIndemnity),
		notes: cleanString(info.notes)
	};
}

export function normalizeData(input: Partial<AppData>): AppData {
	const defaults = createDefaultData();
	const settings = { ...defaults.settings, ...(input.settings ?? {}) };

	return {
		version: 1,
		updatedAt: now(),
		companies: Array.isArray(input.companies) ? input.companies.map(normalizeCompany) : [],
		projects: Array.isArray(input.projects) ? input.projects.map(normalizeProject) : [],
		contracts: Array.isArray(input.contracts) ? input.contracts.map(normalizeContract) : [],
		documents: Array.isArray(input.documents) ? input.documents : [],
		periods: Array.isArray(input.periods) ? input.periods.map(normalizePeriod) : [],
		futureContracts: Array.isArray(input.futureContracts)
			? input.futureContracts.map(normalizeFutureContract)
			: [],
		monthlyInfos: Array.isArray(input.monthlyInfos)
			? input.monthlyInfos.map(normalizeMonthlyInfo).filter((info) => info.month)
			: [],
		settings: {
			...settings,
			annex: normalizeAnnex(settings.annex),
			targetHours: normalizeNumber(settings.targetHours) || defaults.settings.targetHours,
			minDailyAllowance:
				normalizeNumber(settings.minDailyAllowance) || defaults.settings.minDailyAllowance,
			smicHourlyGross:
				normalizeNumber(settings.smicHourlyGross) || defaults.settings.smicHourlyGross,
			annex8SalaryCoefficient:
				normalizeNumber(settings.annex8SalaryCoefficient) ||
				defaults.settings.annex8SalaryCoefficient,
			annex8HoursCoefficient:
				normalizeNumber(settings.annex8HoursCoefficient) ||
				defaults.settings.annex8HoursCoefficient,
			annex8FixedCoefficient: normalizeNumber(settings.annex8FixedCoefficient),
			monthlyWorkDayDivisor:
				normalizeNumber(settings.monthlyWorkDayDivisor) || defaults.settings.monthlyWorkDayDivisor,
			monthlyShiftCoefficient:
				normalizeNumber(settings.monthlyShiftCoefficient) ||
				defaults.settings.monthlyShiftCoefficient,
			pmss: normalizeNumber(settings.pmss) || defaults.settings.pmss,
			cumulPmssMultiplier:
				normalizeNumber(settings.cumulPmssMultiplier) || defaults.settings.cumulPmssMultiplier,
			transatEmail: cleanString(settings.transatEmail),
			ghsApiBaseUrl: cleanString(settings.ghsApiBaseUrl),
			ghsApiToken: cleanString(settings.ghsApiToken),
			ghsSyncEnabled: Boolean(settings.ghsSyncEnabled),
			ghsLastSyncAt: cleanString(settings.ghsLastSyncAt),
			ghsLastSyncStatus:
				cleanString(settings.ghsLastSyncStatus) || defaults.settings.ghsLastSyncStatus,
			activePeriodId: cleanString(settings.activePeriodId),
			remoteBaseUrl: cleanString(settings.remoteBaseUrl) || defaults.settings.remoteBaseUrl,
			remoteSyncEnabled: Boolean(settings.remoteSyncEnabled),
			remoteLastSyncAt: cleanString(settings.remoteLastSyncAt),
			remoteLastSyncStatus:
				cleanString(settings.remoteLastSyncStatus) || defaults.settings.remoteLastSyncStatus
		}
	};
}

export async function readData(): Promise<AppData> {
	const raw = await persistence().readJson();
	if (raw === null) {
		const initial = createDefaultData();
		await persistence().writeJson(initial);
		return normalizeData(initial);
	}
	return normalizeData(raw as AppData);
}

export async function saveData(data: AppData): Promise<AppData> {
	const normalized = normalizeData(data);
	await persistence().writeJson(normalized);
	return normalized;
}

export async function mutateData(mutator: (data: AppData) => AppData | void): Promise<AppData> {
	const data = await readData();
	const result = mutator(data) ?? data;
	return saveData(result);
}

export async function writeStoredFile(storedName: string, buffer: Buffer) {
	await persistence().putFile(storedName, buffer);
}

export async function readStoredFile(storedName: string) {
	return persistence().getFile(storedName);
}

export async function deleteStoredFiles(storedNames: string[]) {
	return persistence().deleteFiles([...new Set(storedNames.filter(Boolean))]);
}

export function usedStoredFiles(data: AppData) {
	return new Set([
		...data.documents.map((document) => document.storedName).filter(Boolean),
		...data.periods.map((period) => period.sourceStoredName).filter(Boolean)
	]);
}

export async function cleanupUnusedDocumentFiles(data: AppData) {
	const used = usedStoredFiles(data ?? (await readData()));
	const files = await persistence().listFiles();
	const unused = files.filter((file) => !used.has(file));
	const deletedFiles = await deleteStoredFiles(unused);

	return {
		deletedFiles,
		deletedCount: deletedFiles.length
	};
}
