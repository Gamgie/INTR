// Règles d'indemnisation des annexes 8 et 10 au règlement d'assurance chômage
// (convention du 15 novembre 2024, textes publiés par l'Unédic).
//   Annexe 8  : ouvriers et techniciens
//   Annexe 10 : artistes du spectacle
// Chaque constante renvoie à l'article dont elle vient. Les montants qui évoluent chaque année
// (AJ minimale, SMIC, PMSS) restent des réglages modifiables dans l'app.

export type Annex = 'Annexe 8' | 'Annexe 10';

export const ANNEXES: Annex[] = ['Annexe 8', 'Annexe 10'];

type AnnexRules = {
	label: string;
	/** Art. 14, partie A : coefficient sur le salaire de référence jusqu'au seuil. */
	salaryCoefficient: number;
	/** Art. 14, partie A : seuil de salaire (€) au-delà duquel le coefficient passe à 0,05. */
	salaryThreshold: number;
	/** Art. 14, partie B : seuil d'heures au-delà duquel le coefficient passe à 0,08. */
	hoursThreshold: number;
	/** Art. 14, partie C. */
	fixedCoefficient: number;
	/** Art. 14 : plancher de l'allocation journalière (€). */
	floor: number;
	/** Art. 30 §1 : heures par jour de travail. */
	hoursPerWorkDay: number;
	/** Art. 30 §1 : coefficient appliqué aux jours de travail. */
	workDayCoefficient: number;
	/** Art. 30 : nombre de jours de travail dans le mois à partir duquel rien n'est versé. */
	noPaymentWorkDays: number;
};

export const RULES: Record<Annex, AnnexRules> = {
	'Annexe 8': {
		label: 'Annexe 8 · ouvriers et techniciens',
		salaryCoefficient: 0.42,
		salaryThreshold: 14_400,
		hoursThreshold: 720,
		fixedCoefficient: 0.4,
		floor: 38,
		hoursPerWorkDay: 8,
		workDayCoefficient: 1.4,
		noPaymentWorkDays: 26
	},
	'Annexe 10': {
		label: 'Annexe 10 · artistes du spectacle',
		salaryCoefficient: 0.36,
		salaryThreshold: 13_700,
		hoursThreshold: 690,
		fixedCoefficient: 0.7,
		floor: 44,
		hoursPerWorkDay: 10,
		workDayCoefficient: 1.3,
		noPaymentWorkDays: 27
	}
};

/** Communs aux deux annexes. */
export const COMMON = {
	/** Art. 3 §1 : heures requises sur les 12 mois précédant la fin du contrat. */
	requiredHours: 507,
	/** Annexe 10, art. 3 §1 : 1 cachet = 12 heures, 28 cachets au plus par mois. */
	hoursPerCachet: 12,
	maxCachetsPerMonth: 28,
	/** Art. 14 : diviseur fixe de la partie A (cas général). */
	salaryDivisor: 5_000,
	/** Art. 14 : coefficient au-delà des seuils, parties A et B. */
	aboveThresholdSalaryCoefficient: 0.05,
	aboveThresholdHoursCoefficient: 0.08,
	/** Art. 14, partie B. */
	hoursCoefficient: 0.26,
	/** Art. 14 : AJ minimale fixée par le texte (réglage modifiable si revalorisée). */
	minDailyAllowance: 31.96,
	/** Art. 16 : plafond = 34,4 % de 1/365 du plafond annuel des contributions (art. 49 : 4 × PASS). */
	capRate: 0.344,
	contributionCeilingPass: 4,
	/** Art. 30 §2 : cumul salaires + allocations dans la limite de 1,18 × PMSS. */
	cumulPmssMultiplier: 1.18,
	/** Art. 22 : délai d'attente (jours). */
	waitingDays: 7
};

export function normalizeAnnex(value: unknown): Annex {
	return value === 'Annexe 10' ? 'Annexe 10' : 'Annexe 8';
}

export type DailyAllowanceInput = {
	annex: Annex;
	/** Salaire de référence brut (€) sur la période de référence. */
	referenceSalary: number;
	/** Nombre d'heures de travail (cachets convertis) sur la période de référence. */
	hours: number;
	/** AJ minimale (€). */
	minDailyAllowance: number;
	/** Plafond mensuel de la Sécurité sociale (€), pour le plafond de l'art. 16. */
	pmss: number;
	/**
	 * Cas de l'art. 9 §1 b (ancien allocataire n'atteignant pas l'affiliation, période étendue
	 * au-delà de 365 jours) : heures exigées et SMIC horaire remplacent les diviseurs fixes.
	 */
	readmission?: { requiredHours: number; smicHourlyGross: number };
};

export type DailyAllowanceDetail = {
	a: number;
	b: number;
	c: number;
	raw: number;
	floor: number;
	cap: number;
	value: number;
	limitedBy: 'plancher' | 'plafond' | '';
};

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Art. 14 et 16 : AJ = A + B + C, puis plancher et plafond. */
export function dailyAllowance(input: DailyAllowanceInput): DailyAllowanceDetail {
	const rules = RULES[input.annex];
	const sr = Math.max(0, input.referenceSalary);
	const hours = Math.max(0, input.hours);
	const aj = input.minDailyAllowance;

	const salaryDivisor = input.readmission
		? input.readmission.requiredHours * input.readmission.smicHourlyGross
		: COMMON.salaryDivisor;
	const hoursDivisor = input.readmission ? input.readmission.requiredHours : COMMON.requiredHours;

	const a =
		(aj *
			(rules.salaryCoefficient * Math.min(sr, rules.salaryThreshold) +
				COMMON.aboveThresholdSalaryCoefficient * Math.max(0, sr - rules.salaryThreshold))) /
		salaryDivisor;
	const b =
		(aj *
			(COMMON.hoursCoefficient * Math.min(hours, rules.hoursThreshold) +
				COMMON.aboveThresholdHoursCoefficient * Math.max(0, hours - rules.hoursThreshold))) /
		hoursDivisor;
	const c = aj * rules.fixedCoefficient;
	const raw = a + b + c;
	const cap =
		input.pmss > 0
			? (COMMON.capRate * COMMON.contributionCeilingPass * 12 * input.pmss) / 365
			: Number.POSITIVE_INFINITY;

	let value = Math.max(raw, rules.floor);
	let limitedBy: DailyAllowanceDetail['limitedBy'] = raw < rules.floor ? 'plancher' : '';
	if (value > cap) {
		value = cap;
		limitedBy = 'plafond';
	}

	return {
		a: roundCents(a),
		b: roundCents(b),
		c: roundCents(c),
		raw: roundCents(raw),
		floor: rules.floor,
		cap: roundCents(cap),
		value: roundCents(value),
		limitedBy
	};
}

export type MonthlyPaymentInput = {
	annex: Annex;
	daysInMonth: number;
	/** Heures travaillées dans le mois (cachets convertis). */
	hours: number;
	/** Rémunérations brutes du mois. */
	grossSalary: number;
	dailyAllowance: number;
	pmss: number;
	cumulPmssMultiplier?: number;
};

/** Art. 30 : jours indemnisables du mois et plafond de cumul. */
export function monthlyPayment(input: MonthlyPaymentInput) {
	const rules = RULES[input.annex];
	const workDays = Math.max(0, input.hours) / rules.hoursPerWorkDay;
	// Le texte ne précise pas l'arrondi des jours non indemnisables : on arrondit à l'entier
	// supérieur, ce qui donne une estimation prudente (jamais plus que ce qui sera versé).
	const nonIndemnifiableDays = Math.min(
		input.daysInMonth,
		Math.ceil(workDays * rules.workDayCoefficient - 1e-9)
	);
	const noPayment = workDays >= rules.noPaymentWorkDays;
	let indemnifiableDays = noPayment ? 0 : Math.max(0, input.daysInMonth - nonIndemnifiableDays);

	const multiplier = input.cumulPmssMultiplier ?? COMMON.cumulPmssMultiplier;
	const ceiling = input.pmss > 0 ? input.pmss * multiplier : Number.POSITIVE_INFINITY;
	let cappedByCumul = false;
	if (input.dailyAllowance > 0 && input.grossSalary + indemnifiableDays * input.dailyAllowance > ceiling) {
		// Art. 30 §3 : écart entre le plafond et les rémunérations, divisé par l'AJ, arrondi à
		// l'entier supérieur.
		const gap = Math.max(0, ceiling - input.grossSalary);
		indemnifiableDays = Math.min(indemnifiableDays, Math.ceil(gap / input.dailyAllowance - 1e-9));
		cappedByCumul = true;
	}

	return {
		workDays: roundCents(workDays),
		nonIndemnifiableDays,
		indemnifiableDays,
		noPayment,
		cappedByCumul,
		ceiling: Number.isFinite(ceiling) ? roundCents(ceiling) : 0,
		amount: roundCents(indemnifiableDays * input.dailyAllowance)
	};
}
