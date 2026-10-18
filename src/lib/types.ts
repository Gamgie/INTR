export type ContractStatus = 'Estimation' | 'Signé' | 'Payé';
export type DocumentKind =
	| 'AEM'
	| 'Contrat'
	| 'Fiche de paie'
	| 'Congé Spectacle'
	| 'Déclaration Guso'
	| 'Notification ARE'
	| 'Autre';

export type Company = {
	id: string;
	name: string;
	legalName: string;
	contactName: string;
	email: string;
	phone: string;
	address: string;
	postalCode: string;
	city: string;
	siren: string;
	siret: string;
	ape: string;
	legalCategory: string;
	activityLabel: string;
	color: string;
	source: string;
	sourceUpdatedAt: string;
	notes: string;
};

export type Project = {
	id: string;
	companyId: string;
	name: string;
	role: string;
	location: string;
	startDate: string;
	endDate: string;
	notes: string;
};

export type ContractDocument = {
	id: string;
	contractId: string;
	kind: DocumentKind;
	fileName: string;
	originalFileName: string;
	storedName: string;
	mimeType: string;
	size: number;
	pageStart: number;
	pageEnd: number;
	uploadedAt: string;
	extractedTextPreview: string;
	extractedFields: Partial<ContractFields>;
	analysisNotes: string[];
};

export type ContractFields = {
	companyId: string;
	projectId: string;
	title: string;
	startDate: string;
	endDate: string;
	hours: number;
	cachets: number;
	employmentStatus: string;
	netSalary: number;
	taxableNetSalary: number;
	grossSalary: number;
	contributions: number;
	/** Total versé par l'employeur (bulletin) : brut + cotisations patronales. */
	employerCost?: number;
	netHourlyRate: number;
	grossHourlyRate: number;
	status: ContractStatus;
	notes: string;
};

export type Contract = ContractFields & {
	id: string;
	documentIds: string[];
	/** Champs corrigés à la main : le recalcul depuis les documents ne les touche plus. */
	manualFields?: string[];
	createdAt: string;
	updatedAt: string;
};

export type FutureContractAmountType = 'employerCost' | 'gross' | 'net';

export type FutureContract = {
	id: string;
	companyName: string;
	amount: number;
	amountType: FutureContractAmountType;
	estimatedHours: number;
	notes: string;
};

export type MonthlyInfo = {
	month: string;
	periodId: string;
	congeSpectacle: number;
	realIndemnity: number;
	dailyIndemnity: number;
	notes: string;
};

export type IntermittencePeriod = {
	id: string;
	label: string;
	status: 'Estimation' | 'Notifie' | 'Archive';
	admissionDate: string;
	indemnizationStartDate: string;
	anniversaryDate: string;
	referenceStartDate: string;
	referenceEndDate: string;
	hours: number;
	cachets: number;
	grossSalary: number;
	dailyAllowance: number;
	waitingDays: number;
	salaryFranchiseDays: number;
	congeFranchiseDays: number;
	sourceFileName: string;
	sourceStoredName: string;
	sourceTextPreview: string;
	analysisNotes: string[];
	createdAt: string;
	updatedAt: string;
	notes: string;
};

export type AppSettings = {
	referenceStartDate: string;
	targetHours: number;
	annex: 'Annexe 8' | 'Annexe 10';
	minDailyAllowance: number;
	smicHourlyGross: number;
	annex8SalaryCoefficient: number;
	annex8HoursCoefficient: number;
	annex8FixedCoefficient: number;
	monthlyWorkDayDivisor: number;
	monthlyShiftCoefficient: number;
	pmss: number;
	cumulPmssMultiplier: number;
	transatEmail: string;
	ghsApiBaseUrl: string;
	ghsApiToken: string;
	ghsSyncEnabled: boolean;
	ghsLastSyncAt: string;
	ghsLastSyncStatus: string;
	activePeriodId: string;
	remoteBaseUrl: string;
	remoteSyncEnabled: boolean;
	remoteLastSyncAt: string;
	remoteLastSyncStatus: string;
	/** Dates anniversaire saisies à la main, par année d'intermittence ({ "2026": "2026-11-15" }). */
	anniversaries: Record<string, string>;
	/** Prénom (ancien modèle de noms de fichiers). */
	ownerFirstName: string;
	/** Noms d'employeurs corrigés à la main, par SIREN (« 213502388 » → « Ville de Rennes - Opéra »). */
	employerNames: Record<string, string>;
	/** kDrive folder (URL or id) holding the original documents to import. */
	kdriveSourceFolder: string;
};

export type AppData = {
	version: 1;
	updatedAt: string;
	companies: Company[];
	projects: Project[];
	contracts: Contract[];
	documents: ContractDocument[];
	periods: IntermittencePeriod[];
	futureContracts: FutureContract[];
	monthlyInfos: MonthlyInfo[];
	kdriveImports: KdriveImport[];
	/** Journal des rangements kDrive, pour pouvoir les annuler. */
	kdriveMoves: KdriveMove[];
	settings: AppSettings;
};

export type KdriveMove = {
	batchId: string;
	fileId: number;
	fromParentId: number;
	fromName: string;
	fromPath: string;
	toParentId: number;
	toName: string;
	toPath: string;
	at: string;
	undone: boolean;
};

/** A source file read from kDrive by « Importer depuis kDrive » (the original is never modified). */
export type KdriveImport = {
	fileId: number;
	path: string;
	size: number;
	importedAt: string;
	status: 'importé' | 'erreur';
	message: string;
	documentIds: string[];
	periodIds: string[];
};

export type MonthlyStats = {
	month: string;
	label: string;
	hours: number;
	cachets: number;
	netSalary: number;
	taxableNetSalary: number;
	grossSalary: number;
	contributions: number;
	employerCost: number;
	contributionRate: number;
	netHourlyRate: number;
	grossHourlyRate: number;
	contractCount: number;
	workedDaysEstimate: number;
	estimatedDailyAllowance: number;
	estimatedIndemnity: number;
	realIndemnity: number;
	congeSpectacle: number;
	totalIncomeEstimated: number;
	totalIncomeReal: number;
};

export type PeriodStats = {
	monthCount: number;
	hours: number;
	cachets: number;
	netSalary: number;
	taxableNetSalary: number;
	grossSalary: number;
	contributions: number;
	contributionRate: number;
	netHourlyRate: number;
	grossHourlyRate: number;
	contractCount: number;
	workedDaysEstimate: number;
	estimatedIndemnity: number;
	realIndemnity: number;
	congeSpectacle: number;
	totalIncomeEstimated: number;
	totalIncomeReal: number;
};

export type CompanySearchResult = {
	id: string;
	score: number;
	name: string;
	legalName: string;
	siren: string;
	siret: string;
	ape: string;
	address: string;
	postalCode: string;
	city: string;
	legalCategory: string;
	activityLabel: string;
	employeeRange: string;
	isEmployer: boolean;
	isAssociation: boolean;
	isEntrepreneurSpectacle: boolean;
	sourceUpdatedAt: string;
	sourceUrl: string;
};

export type CompanySuggestion = {
	contractId: string;
	siret: string;
	result: CompanySearchResult;
};
