import { annexSplit, type AnnexSplit } from '$lib/annex';
import { contractRecognizedHours, round } from '$lib/stats';
import type { AppData } from '$lib/types';
import { intermittenceYears, yearOfDate, type IntermittenceYear } from '$lib/years';

export type EmployerTotal = { name: string; hours: number; grossSalary: number; contracts: number };

export type YearHistory = {
	year: IntermittenceYear;
	hours: number;
	cachets: number;
	grossSalary: number;
	netSalary: number;
	contributions: number;
	contracts: number;
	/** Part des 507 heures atteinte (0 à 1). */
	progress: number;
	/** Indemnisation réelle saisie mois par mois. */
	realIndemnity: number;
	congeSpectacle: number;
	/** Total versé par les employeurs (salaire et charges), d'après les fiches de paie. */
	employerCost: number;
	/** Argent reçu : net payé + ARE + Congés Spectacles. */
	totalIncome: number;
	/** Mois écoulés dans l'année (12 pour une année finie). */
	months: number;
	/** Argent reçu par mois écoulé. */
	monthlyIncome: number;
	/** Brut par heure reconnue (cachets comptés 12 h). */
	grossPerHour: number;
	/** Évolution du brut par rapport à l'année d'avant (0,1 = +10 %), si les deux sont finies. */
	grossChange?: number;
	/** Part des heures faites chez le premier employeur (0 à 1). */
	topEmployerShare: number;
	employers: EmployerTotal[];
	/** Heures par annexe, d'après l'emploi de chaque contrat. */
	annexes: AnnexSplit;
};

/** Totaux par année d'intermittence, de la plus récente à la plus ancienne. */
export function buildYearHistory(data: AppData, today = new Date()): YearHistory[] {
	const years = intermittenceYears(data, today).filter((year) => !year.isFuture);
	const byYear = new Map(
		years.map((year) => [
			year.year,
			{
				year,
				hours: 0,
				cachets: 0,
				grossSalary: 0,
				netSalary: 0,
				contributions: 0,
				employerCost: 0,
				contracts: 0,
				progress: 0,
				realIndemnity: 0,
				congeSpectacle: 0,
				employers: new Map<string, EmployerTotal>(),
				contractList: [] as AppData['contracts']
			}
		])
	);
	const companyName = (id: string) =>
		data.companies.find((company) => company.id === id)?.name || 'Sans structure';

	for (const contract of data.contracts) {
		const entry = byYear.get(yearOfDate(data, contract.startDate) ?? 0);
		if (!entry) continue;
		const hours = contractRecognizedHours(contract);
		entry.hours += hours;
		entry.cachets += contract.cachets;
		entry.grossSalary += contract.grossSalary;
		entry.netSalary += contract.netSalary;
		entry.contributions += contract.contributions;
		entry.employerCost += contract.employerCost ?? 0;
		entry.contracts += 1;
		entry.contractList.push(contract);
		const name = companyName(contract.companyId);
		const employer = entry.employers.get(name) ?? { name, hours: 0, grossSalary: 0, contracts: 0 };
		employer.hours += hours;
		employer.grossSalary += contract.grossSalary;
		employer.contracts += 1;
		entry.employers.set(name, employer);
	}

	// Un mois appartient à l'année qui contient son milieu.
	for (const info of data.monthlyInfos) {
		const entry = byYear.get(yearOfDate(data, `${info.month}-15`) ?? 0);
		if (!entry) continue;
		entry.realIndemnity += info.realIndemnity;
		entry.congeSpectacle += info.congeSpectacle;
	}

	// Indemnités Congés Spectacles saisies pour l'année entière (classeur, relevé Audiens).
	for (const [yearText, amount] of Object.entries(data.settings.congesSpectaclesByYear ?? {})) {
		const entry = byYear.get(Number(yearText));
		if (entry) entry.congeSpectacle += Number(amount) || 0;
	}

	const target = data.settings.targetHours || 507;
	const list = years.map((year) => {
		const { contractList, ...entry } = byYear.get(year.year)!;
		const employers = [...entry.employers.values()]
			.map((employer) => ({
				...employer,
				hours: round(employer.hours),
				grossSalary: round(employer.grossSalary)
			}))
			.sort((a, b) => b.hours - a.hours);
		const totalIncome = entry.netSalary + entry.realIndemnity + entry.congeSpectacle;
		const months = elapsedMonths(year.start, year.end, today);
		return {
			...entry,
			annexes: annexSplit(contractList),
			hours: round(entry.hours),
			cachets: round(entry.cachets),
			grossSalary: round(entry.grossSalary),
			netSalary: round(entry.netSalary),
			contributions: round(entry.contributions),
			employerCost: round(entry.employerCost),
			realIndemnity: round(entry.realIndemnity),
			congeSpectacle: round(entry.congeSpectacle),
			totalIncome: round(totalIncome),
			months,
			monthlyIncome: months > 0 ? round(totalIncome / months) : 0,
			grossPerHour: entry.hours > 0 ? round(entry.grossSalary / entry.hours) : 0,
			grossChange: undefined as number | undefined,
			topEmployerShare: entry.hours > 0 && employers.length ? employers[0].hours / entry.hours : 0,
			progress: Math.min(1, entry.hours / target),
			employers
		};
	});

	// Évolution du brut d'une année finie à l'autre (la liste va de la plus récente à la plus ancienne).
	list.forEach((entry, index) => {
		const previous = list[index + 1];
		if (entry.year.isCurrent || !previous || previous.grossSalary <= 0) return;
		entry.grossChange = entry.grossSalary / previous.grossSalary - 1;
	});
	return list;
}

/** Mois écoulés entre le début de l'année et aujourd'hui (ou sa fin), arrondis au dixième. */
export function elapsedMonths(start: string, end: string, today = new Date()) {
	const from = new Date(`${start}T00:00:00`);
	const to = new Date(`${end}T00:00:00`);
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 12;
	const limit = today < to ? today : to;
	const days = (limit.getTime() - from.getTime()) / 86_400_000 + 1;
	if (days <= 0) return 0;
	return Math.min(12, Math.round((days / (365.25 / 12)) * 10) / 10);
}
