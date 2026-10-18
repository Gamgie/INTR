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
	return years.map((year) => {
		const { contractList, ...entry } = byYear.get(year.year)!;
		return {
			...entry,
			annexes: annexSplit(contractList),
			hours: round(entry.hours),
			cachets: round(entry.cachets),
			grossSalary: round(entry.grossSalary),
			netSalary: round(entry.netSalary),
			contributions: round(entry.contributions),
			realIndemnity: round(entry.realIndemnity),
			congeSpectacle: round(entry.congeSpectacle),
			progress: Math.min(1, entry.hours / target),
			employers: [...entry.employers.values()]
				.map((employer) => ({ ...employer, hours: round(employer.hours), grossSalary: round(employer.grossSalary) }))
				.sort((a, b) => b.hours - a.hours)
		};
	});
}
