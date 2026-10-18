// Découpage en années d'intermittence (dates anniversaire).
import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } });

const contract = (startDate) => ({ startDate, endDate: startDate, hours: 10, cachets: 0, employmentStatus: '', grossSalary: 100 });
const base = (overrides = {}) => ({
	contracts: [],
	periods: [],
	monthlyInfos: [],
	settings: { activePeriodId: '', anniversaries: { 2026: '2026-11-15' }, ...overrides }
});

try {
	const years = await server.ssrLoadModule('/src/lib/years.ts');
	const today = new Date('2026-10-18T12:00:00');

	const data = base();
	data.contracts = ['2022-05-10', '2025-11-20', '2025-12-01', '2026-11-15', '2026-11-16'].map(contract);
	data.periods = [{ id: 'n1', anniversaryDate: '2025-11-27', dailyAllowance: 61.2 }];

	// Saisie 2026 (15/11), notification 2025 (27/11), estimation pour les autres (même jour que la plus proche).
	assert.equal(years.yearOfDate(data, '2025-11-20'), 2025, 'avant l’anniversaire 2025');
	assert.equal(years.yearOfDate(data, '2025-12-01'), 2026, 'après l’anniversaire 2025');
	assert.equal(years.yearOfDate(data, '2026-11-15'), 2026, 'le jour anniversaire clôt l’année');
	assert.equal(years.yearOfDate(data, '2026-11-16'), 2027, 'le lendemain ouvre l’année suivante');
	assert.equal(years.yearOfDate(data, '2022-05-10'), 2022);

	// Période de référence d'une notification : son début suit l'anniversaire de l'année d'avant.
	const withReference = base();
	withReference.periods = [{ id: 'n2', anniversaryDate: '2024-11-30', referenceStartDate: '2022-12-03', referenceEndDate: '2023-11-30' }];
	assert.equal(years.yearOfDate(withReference, '2022-12-01'), 2022, 'le 01/12/2022 est encore dans l’année 2022');
	assert.equal(years.yearOfDate(withReference, '2022-12-02'), 2022);
	assert.equal(years.yearOfDate(withReference, '2022-12-03'), 2023);

	const current = years.currentIntermittenceYear(data, today);
	assert.equal(current.year, 2026);
	assert.equal(current.start, '2025-11-28');
	assert.equal(current.end, '2026-11-15');
	assert.equal(current.source, 'saisie');
	assert.equal(current.isCurrent, true);

	const list = years.intermittenceYears(data, today);
	assert.deepEqual(list.map((year) => year.year), [2027, 2026, 2025, 2022]);
	const y2025 = years.anniversaryFor(data, 2025);
	assert.equal(y2025.source, 'notification');
	const y2022 = list.find((year) => year.year === 2022);
	assert.equal(y2022.source, 'estimée');
	assert.equal(y2022.end, '2022-11-27', 'estimée sur la notification la plus proche');

	// Sélection : vide = année en cours ; year:2022 ; all = aucune borne.
	assert.equal(years.selectedIntermittenceYear(data, today).year, 2026);
	data.settings.activePeriodId = 'year:2022';
	assert.equal(years.selectedIntermittenceYear(data, today).year, 2022);
	data.settings.activePeriodId = 'all';
	assert.equal(years.selectedIntermittenceYear(data, today), undefined);
	data.settings.activePeriodId = 'n1';
	assert.equal(years.selectedIntermittenceYear(data, today).year, 2026, 'ancien identifiant : année en cours');

	// L'AJ notifiée suit son année.
	data.settings.activePeriodId = 'year:2025';
	const period = years.yearAsPeriod(years.selectedIntermittenceYear(data, today));
	assert.equal(period.dailyAllowance, 61.2);
	assert.equal(period.anniversaryDate, '2025-11-27');

	// Sans aucune date connue : 25 novembre.
	assert.equal(years.anniversaryFor(base({ anniversaries: {} }), 2024).date, '2024-11-25');

	// Les calculs de l'année en cours ignorent les contrats des autres années.
	const stats = await server.ssrLoadModule('/src/lib/stats.ts');
	const statsData = { ...base(), companies: [], projects: [], documents: [], futureContracts: [], kdriveImports: [] };
	statsData.settings = { ...statsData.settings, targetHours: 507, annex: 'Annexe 8', minDailyAllowance: 31.96, pmss: 4005, cumulPmssMultiplier: 1.18, referenceStartDate: '2026-01-01' };
	statsData.contracts = ['2024-03-01', '2025-10-01', '2026-02-01', '2026-09-01'].map(contract);
	const realNow = Date.now;
	const reference = stats.calculateReference(statsData);
	assert.equal(reference.contractCount, 2, `seulement 2026 (${reference.contractCount})`);
	Date.now = realNow;

	console.log('Intermittence years tests passed.');
} finally {
	await server.close();
}
