// Cas calculés à la main à partir des annexes 8 et 10 (convention du 15 novembre 2024).
import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } });

try {
	const { dailyAllowance, monthlyPayment } = await server.ssrLoadModule('/src/lib/rules.ts');
	const base = { minDailyAllowance: 31.96, pmss: 4005 };

	// Annexe 8, SR 12 000 €, 600 h : A = 31,96×0,42×12000/5000, B = 31,96×0,26×600/507, C = 31,96×0,40
	const a8 = dailyAllowance({ ...base, annex: 'Annexe 8', referenceSalary: 12000, hours: 600 });
	assert.equal(a8.a, 32.22);
	assert.equal(a8.b, 9.83);
	assert.equal(a8.c, 12.78);
	assert.equal(a8.value, 54.83);

	// Annexe 8, au-delà des seuils : 20 000 € (14 400 €) et 900 h (720 h)
	const a8High = dailyAllowance({ ...base, annex: 'Annexe 8', referenceSalary: 20000, hours: 900 });
	assert.equal(a8High.a, round((31.96 * (0.42 * 14400 + 0.05 * 5600)) / 5000));
	assert.equal(a8High.b, round((31.96 * (0.26 * 720 + 0.08 * 180)) / 507));

	// Annexe 10, SR 20 000 €, 800 h : seuils 13 700 € et 690 h, C = 0,70
	const a10 = dailyAllowance({ ...base, annex: 'Annexe 10', referenceSalary: 20000, hours: 800 });
	assert.equal(a10.a, 33.54);
	assert.equal(a10.b, 11.86);
	assert.equal(a10.c, 22.37);
	assert.equal(a10.value, 67.77);

	// Plancher annexe 10 (44 €) et annexe 8 (38 €)
	const low10 = dailyAllowance({ ...base, annex: 'Annexe 10', referenceSalary: 5000, hours: 507 });
	assert.equal(low10.raw, 42.19);
	assert.equal(low10.value, 44);
	assert.equal(low10.limitedBy, 'plancher');
	const low8 = dailyAllowance({ ...base, annex: 'Annexe 8', referenceSalary: 5000, hours: 507 });
	assert.equal(low8.value, 38);

	// Plafond art. 16 : 34,4 % × 4 × PASS (12 × 4 005 €) / 365
	const huge = dailyAllowance({ ...base, annex: 'Annexe 10', referenceSalary: 400000, hours: 3000 });
	assert.equal(huge.cap, 181.18);
	assert.equal(huge.value, 181.18);
	assert.equal(huge.limitedBy, 'plafond');

	// Diviseurs de l'art. 9 §1 b : heures exigées × SMIC, heures exigées
	const readmission = dailyAllowance({
		...base,
		annex: 'Annexe 8',
		referenceSalary: 12000,
		hours: 600,
		readmission: { requiredHours: 591, smicHourlyGross: 12.31 }
	});
	assert.equal(readmission.a, round((31.96 * 0.42 * 12000) / (591 * 12.31)));
	assert.equal(readmission.b, round((31.96 * 0.26 * 600) / 591));

	// Art. 30 annexe 8 : 40 h → 5 jours × 1,4 = 7 jours non indemnisés sur 30
	const m8 = monthlyPayment({ annex: 'Annexe 8', daysInMonth: 30, hours: 40, grossSalary: 800, dailyAllowance: 60, pmss: 4005 });
	assert.equal(m8.nonIndemnifiableDays, 7);
	assert.equal(m8.indemnifiableDays, 23);
	assert.equal(m8.amount, 1380);

	// Art. 30 annexe 10 : 3 cachets = 36 h → 3,6 jours × 1,3 = 4,68 → 5 jours
	const m10 = monthlyPayment({ annex: 'Annexe 10', daysInMonth: 31, hours: 36, grossSalary: 600, dailyAllowance: 60, pmss: 4005 });
	assert.equal(m10.nonIndemnifiableDays, 5);
	assert.equal(m10.indemnifiableDays, 26);

	// Plafond de cumul 1,18 × PMSS : écart (4 725,90 − 4 000) / 60 = 12,1 → 13 jours
	const capped = monthlyPayment({ annex: 'Annexe 8', daysInMonth: 30, hours: 40, grossSalary: 4000, dailyAllowance: 60, pmss: 4005 });
	assert.equal(capped.ceiling, 4725.9);
	assert.equal(capped.cappedByCumul, true);
	assert.equal(capped.indemnifiableDays, 13);

	// 26 jours de travail (annexe 8) ou 27 (annexe 10) : rien n'est versé
	assert.equal(monthlyPayment({ annex: 'Annexe 8', daysInMonth: 31, hours: 208, grossSalary: 0, dailyAllowance: 60, pmss: 4005 }).amount, 0);
	assert.equal(monthlyPayment({ annex: 'Annexe 10', daysInMonth: 31, hours: 260, grossSalary: 0, dailyAllowance: 60, pmss: 4005 }).noPayment, false);
	assert.equal(monthlyPayment({ annex: 'Annexe 10', daysInMonth: 31, hours: 270, grossSalary: 0, dailyAllowance: 60, pmss: 4005 }).noPayment, true);

	console.log('Annex rules tests passed.');
} finally {
	await server.close();
}

function round(value) {
	return Math.round(value * 100) / 100;
}
