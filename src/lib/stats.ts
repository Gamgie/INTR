import { dailyAllowance, monthlyPayment, normalizeAnnex } from '$lib/rules';
import { selectedIntermittenceYear, yearAsPeriod } from '$lib/years';
import type {
	AppData,
	Contract,
	IntermittencePeriod,
	MonthlyInfo,
	MonthlyStats,
	PeriodStats
} from '$lib/types';

export type MonthlyContractBreakdown = {
	contract: Contract;
	month: string;
	ratio: number;
	hours: number;
	cachets: number;
	netSalary: number;
	taxableNetSalary: number;
	grossSalary: number;
	contributions: number;
};

const monthFormatter = new Intl.DateTimeFormat('fr-FR', {
	month: 'short',
	year: 'numeric'
});

function normalizeEmploymentStatus(value: string) {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export function cachetHoursMultiplier(contract: Pick<Contract, 'employmentStatus'>) {
	return normalizeEmploymentStatus(contract.employmentStatus).includes('technicien') ? 8 : 12;
}

export function contractRecognizedHours(
	contract: Pick<Contract, 'hours' | 'cachets' | 'employmentStatus'>
) {
	return contract.hours > 0 ? contract.hours : contract.cachets * cachetHoursMultiplier(contract);
}

export function round(value: number, precision = 2) {
	const factor = 10 ** precision;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function monthKey(date: Date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey() {
	return monthKey(new Date());
}

export function monthLabel(key: string) {
	const [year, month] = key.split('-').map(Number);
	if (!year || !month) return key;
	return monthFormatter.format(new Date(year, month - 1, 1));
}

export function daysInMonth(key: string) {
	const [year, month] = key.split('-').map(Number);
	if (!year || !month) return 30;
	return new Date(year, month, 0).getDate();
}

function parseDate(value: string) {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Période des calculs : par défaut l'année d'intermittence en cours (bornée par les dates
 * anniversaire), une autre année si elle est choisie, aucune borne pour « toutes les années ».
 */
export function getActivePeriod(data: AppData) {
	const year = selectedIntermittenceYear(data);
	return year ? yearAsPeriod(year) : undefined;
}

function getPeriodStart(period: IntermittencePeriod) {
	return parseDate(period.indemnizationStartDate || period.referenceStartDate);
}

function getPeriodEnd(period: IntermittencePeriod) {
	return parseDate(period.anniversaryDate || period.referenceEndDate);
}

function isDateInsidePeriod(value: string, period?: IntermittencePeriod) {
	if (!period) return true;
	const date = parseDate(value);
	if (!date) return false;
	const start = getPeriodStart(period);
	const end = getPeriodEnd(period);
	return (!start || date >= start) && (!end || date <= end);
}

function isMonthInsidePeriod(month: string, period?: IntermittencePeriod) {
	if (!period) return true;
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber) return false;

	const monthStart = new Date(year, monthNumber - 1, 1);
	const monthEnd = new Date(year, monthNumber, 0);
	const start = getPeriodStart(period);
	const end = getPeriodEnd(period);

	return (!end || monthStart <= end) && (!start || monthEnd >= start);
}

function clampDateToDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function splitContractAcrossMonths(contract: Contract) {
	const start = parseDate(contract.startDate);
	const end = parseDate(contract.endDate) ?? start;

	if (!start || !end) return [];

	const startDate = clampDateToDay(start);
	const endDate = clampDateToDay(end < start ? start : end);
	const totalDays = Math.max(
		1,
		Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1
	);
	const splits: { month: string; ratio: number }[] = [];
	let cursor = startDate;

	while (cursor <= endDate) {
		const key = monthKey(cursor);
		const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
		const segmentEnd = monthEnd < endDate ? monthEnd : endDate;
		const segmentDays = Math.floor((segmentEnd.getTime() - cursor.getTime()) / 86400000) + 1;
		splits.push({ month: key, ratio: segmentDays / totalDays });
		cursor = addDays(segmentEnd, 1);
	}

	return splits;
}

export function getMonthlyInfo(data: AppData, month: string): MonthlyInfo {
	const activePeriodId = data.settings.activePeriodId;
	return (
		data.monthlyInfos.find(
			(info) =>
				info.month === month &&
				(!activePeriodId || info.periodId === activePeriodId || !info.periodId)
		) ?? {
			month,
			periodId: activePeriodId,
			congeSpectacle: 0,
			realIndemnity: 0,
			dailyIndemnity: 0,
			notes: ''
		}
	);
}

export function calculateReference(data: AppData) {
	const activePeriod = getActivePeriod(data);
	const referenceStart = activePeriod
		? getPeriodStart(activePeriod)
		: parseDate(data.settings.referenceStartDate);
	const referenceEnd = activePeriod ? getPeriodEnd(activePeriod) : undefined;
	const eligibleContracts = data.contracts.filter((contract) => {
		const start = parseDate(contract.startDate);
		return (
			start &&
			(!referenceStart || start >= referenceStart) &&
			(!referenceEnd || start <= referenceEnd)
		);
	});
	const hours = eligibleContracts.reduce(
		(total, contract) => total + contractRecognizedHours(contract),
		0
	);
	const grossSalary = eligibleContracts.reduce(
		(total, contract) => total + contract.grossSalary,
		0
	);
	const netSalary = eligibleContracts.reduce((total, contract) => total + contract.netSalary, 0);
	const paidContracts = eligibleContracts.filter((contract) => contract.status === 'Payé').length;
	const signedContracts = eligibleContracts.filter(
		(contract) => contract.status === 'Signé'
	).length;
	const estimatedContracts = eligibleContracts.filter(
		(contract) => contract.status === 'Estimation'
	).length;

	return {
		hours,
		grossSalary,
		netSalary,
		contractCount: eligibleContracts.length,
		paidContracts,
		signedContracts,
		estimatedContracts,
		progress: data.settings.targetHours > 0 ? Math.min(1, hours / data.settings.targetHours) : 0
	};
}

export function estimateDailyAllowanceDetail(data: AppData) {
	const reference = calculateReference(data);
	const settings = data.settings;

	return dailyAllowance({
		annex: normalizeAnnex(settings.annex),
		referenceSalary: reference.grossSalary,
		hours: reference.hours,
		minDailyAllowance: settings.minDailyAllowance,
		pmss: settings.pmss
	});
}

export function estimateDailyAllowance(data: AppData) {
	const activePeriod = getActivePeriod(data);
	if (activePeriod?.dailyAllowance) return activePeriod?.dailyAllowance;

	const reference = calculateReference(data);
	if (!reference.hours || !reference.grossSalary) return 0;

	return round(estimateDailyAllowanceDetail(data).value);
}

export function estimateMonthlyIndemnity(
	data: AppData,
	month: string,
	hours: number,
	grossSalary: number
) {
	const info = getMonthlyInfo(data, month);
	const dailyAllowance =
		info.dailyIndemnity > 0 ? info.dailyIndemnity : estimateDailyAllowance(data);
	const payment = monthlyPayment({
		annex: normalizeAnnex(data.settings.annex),
		daysInMonth: daysInMonth(month),
		hours,
		grossSalary,
		dailyAllowance,
		pmss: data.settings.pmss,
		cumulPmssMultiplier: data.settings.cumulPmssMultiplier
	});

	return {
		dailyAllowance,
		workedDaysEstimate: payment.nonIndemnifiableDays,
		estimatedIndemnity: payment.amount
	};
}

export function buildMonthlyStats(data: AppData): MonthlyStats[] {
	const map = new Map<string, MonthlyStats>();
	const activePeriod = getActivePeriod(data);

	function ensure(month: string): MonthlyStats {
		const existing = map.get(month);
		if (existing) return existing;

		const info = getMonthlyInfo(data, month);
		const created: MonthlyStats = {
			month,
			label: monthLabel(month),
			hours: 0,
			cachets: 0,
			netSalary: 0,
			taxableNetSalary: 0,
			grossSalary: 0,
			contributions: 0,
			employerCost: 0,
			contributionRate: 0,
			netHourlyRate: 0,
			grossHourlyRate: 0,
			contractCount: 0,
			workedDaysEstimate: 0,
			estimatedDailyAllowance: 0,
			estimatedIndemnity: 0,
			realIndemnity: info.realIndemnity,
			congeSpectacle: info.congeSpectacle,
			totalIncomeEstimated: 0,
			totalIncomeReal: 0
		};

		map.set(month, created);
		return created;
	}

	for (const contract of data.contracts) {
		if (!isDateInsidePeriod(contract.startDate, activePeriod)) continue;
		const splits = splitContractAcrossMonths(contract);

		for (const split of splits) {
			if (!isMonthInsidePeriod(split.month, activePeriod)) continue;
			const stats = ensure(split.month);
			const hours = contractRecognizedHours(contract) * split.ratio;
			stats.hours += hours;
			stats.cachets += contract.cachets * split.ratio;
			stats.netSalary += contract.netSalary * split.ratio;
			stats.taxableNetSalary += contract.taxableNetSalary * split.ratio;
			stats.grossSalary += contract.grossSalary * split.ratio;
			stats.contributions += contract.contributions * split.ratio;
			stats.employerCost += (contract.employerCost ?? 0) * split.ratio;
			stats.contractCount += split.ratio;
		}
	}

	for (const info of data.monthlyInfos) {
		if (
			info.month &&
			isMonthInsidePeriod(info.month, activePeriod) &&
			(!activePeriod || info.periodId === activePeriod.id || !info.periodId)
		) {
			ensure(info.month);
		}
	}

	return Array.from(map.values())
		.map((stats) => {
			const indemnity = estimateMonthlyIndemnity(data, stats.month, stats.hours, stats.grossSalary);

			return {
				...stats,
				hours: round(stats.hours),
				cachets: round(stats.cachets),
				netSalary: round(stats.netSalary),
				taxableNetSalary: round(stats.taxableNetSalary),
				grossSalary: round(stats.grossSalary),
				contributions: round(stats.contributions),
				employerCost: round(stats.employerCost),
				contributionRate:
					stats.grossSalary > 0 ? round((stats.contributions / stats.grossSalary) * 100, 1) : 0,
				netHourlyRate: stats.hours > 0 ? round(stats.netSalary / stats.hours) : 0,
				grossHourlyRate: stats.hours > 0 ? round(stats.grossSalary / stats.hours) : 0,
				contractCount: round(stats.contractCount, 1),
				workedDaysEstimate: indemnity.workedDaysEstimate,
				estimatedDailyAllowance: indemnity.dailyAllowance,
				estimatedIndemnity: indemnity.estimatedIndemnity,
				totalIncomeEstimated: round(
					stats.netSalary + indemnity.estimatedIndemnity + stats.congeSpectacle
				),
				totalIncomeReal: round(stats.netSalary + stats.realIndemnity + stats.congeSpectacle)
			};
		})
		.sort((a, b) => b.month.localeCompare(a.month));
}

export function buildMonthlyContractBreakdown(
	data: AppData,
	month: string
): MonthlyContractBreakdown[] {
	const activePeriod = getActivePeriod(data);
	if (!isMonthInsidePeriod(month, activePeriod)) return [];

	return data.contracts
		.flatMap((contract) => {
			if (!isDateInsidePeriod(contract.startDate, activePeriod)) return [];

			const split = splitContractAcrossMonths(contract).find((item) => item.month === month);
			if (!split) return [];

			return [
				{
					contract,
					month,
					ratio: split.ratio,
					hours: round(contractRecognizedHours(contract) * split.ratio),
					cachets: round(contract.cachets * split.ratio),
					netSalary: round(contract.netSalary * split.ratio),
					taxableNetSalary: round(contract.taxableNetSalary * split.ratio),
					grossSalary: round(contract.grossSalary * split.ratio),
					contributions: round(contract.contributions * split.ratio)
				}
			];
		})
		.sort(
			(a, b) =>
				(a.contract.startDate || '').localeCompare(b.contract.startDate || '') ||
				a.contract.title.localeCompare(b.contract.title)
		);
}

export function buildPeriodStats(data: AppData): PeriodStats {
	const months = buildMonthlyStats(data);
	const totals = months.reduce<PeriodStats>(
		(total, stats) => ({
			monthCount: total.monthCount + 1,
			hours: total.hours + stats.hours,
			cachets: total.cachets + stats.cachets,
			netSalary: total.netSalary + stats.netSalary,
			taxableNetSalary: total.taxableNetSalary + stats.taxableNetSalary,
			grossSalary: total.grossSalary + stats.grossSalary,
			contributions: total.contributions + stats.contributions,
			contributionRate: 0,
			netHourlyRate: 0,
			grossHourlyRate: 0,
			contractCount: total.contractCount + stats.contractCount,
			workedDaysEstimate: total.workedDaysEstimate + stats.workedDaysEstimate,
			estimatedIndemnity: total.estimatedIndemnity + stats.estimatedIndemnity,
			realIndemnity: total.realIndemnity + stats.realIndemnity,
			congeSpectacle: total.congeSpectacle + stats.congeSpectacle,
			totalIncomeEstimated: total.totalIncomeEstimated + stats.totalIncomeEstimated,
			totalIncomeReal: total.totalIncomeReal + stats.totalIncomeReal
		}),
		{
			monthCount: 0,
			hours: 0,
			cachets: 0,
			netSalary: 0,
			taxableNetSalary: 0,
			grossSalary: 0,
			contributions: 0,
			contributionRate: 0,
			netHourlyRate: 0,
			grossHourlyRate: 0,
			contractCount: 0,
			workedDaysEstimate: 0,
			estimatedIndemnity: 0,
			realIndemnity: 0,
			congeSpectacle: 0,
			totalIncomeEstimated: 0,
			totalIncomeReal: 0
		}
	);

	return {
		...totals,
		hours: round(totals.hours),
		cachets: round(totals.cachets),
		netSalary: round(totals.netSalary),
		taxableNetSalary: round(totals.taxableNetSalary),
		grossSalary: round(totals.grossSalary),
		contributions: round(totals.contributions),
		contributionRate:
			totals.grossSalary > 0 ? round((totals.contributions / totals.grossSalary) * 100, 1) : 0,
		netHourlyRate: totals.hours > 0 ? round(totals.netSalary / totals.hours) : 0,
		grossHourlyRate: totals.hours > 0 ? round(totals.grossSalary / totals.hours) : 0,
		contractCount: round(totals.contractCount, 1),
		estimatedIndemnity: round(totals.estimatedIndemnity),
		realIndemnity: round(totals.realIndemnity),
		congeSpectacle: round(totals.congeSpectacle),
		totalIncomeEstimated: round(totals.totalIncomeEstimated),
		totalIncomeReal: round(totals.totalIncomeReal)
	};
}

export function buildTimelineMonths(data: AppData) {
	const months = new Set<string>();
	const today = new Date();
	const activePeriod = getActivePeriod(data);

	if (activePeriod) {
		const start = getPeriodStart(activePeriod);
		const end = getPeriodEnd(activePeriod);

		if (start && end) {
			let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
			const limit = new Date(end.getFullYear(), end.getMonth(), 1);

			while (cursor <= limit) {
				months.add(monthKey(cursor));
				cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
			}
		}
	} else {
		for (let offset = -2; offset < 12; offset += 1) {
			months.add(monthKey(new Date(today.getFullYear(), today.getMonth() + offset, 1)));
		}
	}

	for (const contract of data.contracts) {
		if (!isDateInsidePeriod(contract.startDate, activePeriod)) continue;
		for (const split of splitContractAcrossMonths(contract)) {
			if (isMonthInsidePeriod(split.month, activePeriod)) months.add(split.month);
		}
	}

	for (const info of data.monthlyInfos) {
		if (
			info.month &&
			isMonthInsidePeriod(info.month, activePeriod) &&
			(!activePeriod || info.periodId === activePeriod.id || !info.periodId)
		) {
			months.add(info.month);
		}
	}

	return Array.from(months).sort();
}
