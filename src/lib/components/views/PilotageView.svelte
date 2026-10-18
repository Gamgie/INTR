<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import DocumentPresence from '$lib/components/DocumentPresence.svelte';
	import { formatCurrency, formatDate, formatNumber } from '$lib/format';
	import ImportFeedback from '$lib/components/ImportFeedback.svelte';
	import { buildMonthlyContractBreakdown, contractRecognizedHours, monthLabel } from '$lib/stats';
	import type { Contract } from '$lib/types';

	let { state: appState }: { state: IntrState } = $props();

	const declarationDayFormatter = new Intl.DateTimeFormat('fr-FR', {
		weekday: 'long',
		day: 'numeric'
	});

	let declarationContracts = $derived.by(() =>
		buildMonthlyContractBreakdown(appState.appData, appState.selectedMonth)
			.map((detail) => {
				const period = declarationPeriod(detail.contract, appState.selectedMonth);
				const hasCachets = detail.cachets > 0;

				return {
					...detail,
					declaredHours: hasCachets ? 0 : detail.hours,
					declaredCachets: detail.cachets,
					periodStart: period.start,
					periodEnd: period.end
				};
			})
			.filter(
				(detail) => detail.declaredHours > 0 || detail.declaredCachets > 0 || detail.grossSalary > 0
			)
	);

	function parseDate(value: string) {
		const date = new Date(`${value}T00:00:00`);
		return Number.isNaN(date.getTime()) ? undefined : date;
	}

	function isoDate(date: Date) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
	}

	function monthBounds(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return undefined;

		return {
			start: new Date(year, monthNumber - 1, 1),
			end: new Date(year, monthNumber, 0)
		};
	}

	function declarationPeriod(contract: Contract, month: string) {
		const contractStart = parseDate(contract.startDate);
		const contractEnd = parseDate(contract.endDate) ?? contractStart;
		const bounds = monthBounds(month);

		if (!contractStart || !contractEnd || !bounds) {
			return {
				start: contract.startDate,
				end: contract.endDate || contract.startDate
			};
		}

		const normalizedEnd = contractEnd < contractStart ? contractStart : contractEnd;
		const start = contractStart < bounds.start ? bounds.start : contractStart;
		const end = normalizedEnd > bounds.end ? bounds.end : normalizedEnd;

		return {
			start: isoDate(start),
			end: isoDate(end)
		};
	}

	function formatDeclarationDay(value: string) {
		const date = parseDate(value);
		return date ? declarationDayFormatter.format(date) : '-';
	}

	function quantityDigits(value: number) {
		return Math.abs(value - Math.round(value)) > 0.01 ? 1 : 0;
	}

	function selectCalendarMonth(month: string) {
		appState.selectMonth(month);
	}

	function openContract(contract: Contract) {
		appState.selectedContractId = contract.id;
		appState.activeTab = 'contrats';
	}
</script>

<section class="view-grid two-columns">
	<section class="panel">
		<div class="panel-heading">
			<h3>Contrats récents</h3>
			<div class="button-row">
				<label class="file-button" title="Importer et ranger automatiquement des documents">
					Importer
					<input
						type="file"
						multiple
						accept=".pdf,.txt,.csv,.md,application/pdf,text/*"
						onchange={(event) => {
							event.stopPropagation();
							appState.createContractFromDocument(event);
						}}
					/>
				</label>
				<button type="button" title="Ajouter un contrat" onclick={() => appState.addContract()}
					>+</button
				>
			</div>
		</div>
		<ImportFeedback state={appState} />
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Contrat</th>
						<th>Projet</th>
						<th>Période</th>
						<th>Heures</th>
						<th>Net</th>
						<th>Statut</th>
						<th>Documents</th>
					</tr>
				</thead>
				<tbody>
					{#each appState.recentContracts as contract}
						<tr class:clickable={true} onclick={() => openContract(contract)}>
							<td>
								<span class="company-list-title">
									<span
										class="company-swatch"
										style={`--company-color: ${appState.companyColor(contract.companyId)}`}
										aria-hidden="true"
									></span>
									{contract.title}
								</span>
							</td>
							<td>{appState.projectName(contract.projectId)}</td>
							<td>{formatDate(contract.startDate)} - {formatDate(contract.endDate)}</td>
							<td>{formatNumber(contractRecognizedHours(contract), 0)}</td>
							<td>{formatCurrency(contract.netSalary)}</td>
							<td><span class="status" data-status={contract.status}>{contract.status}</span></td>
							<td><DocumentPresence documents={appState.documentsFor(contract)} /></td>
						</tr>
					{/each}
					{#if appState.recentContracts.length === 0}
						<tr>
							<td colspan="7" class="empty">Aucun contrat pour le moment.</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</section>

	<section class="panel">
		<div class="panel-heading">
			<h3>Mois sélectionné</h3>
			<select
				value={appState.selectedMonth}
				onchange={(event) => selectCalendarMonth(event.currentTarget.value)}
			>
				{#each appState.timelineMonths as month}
					<option value={month}>{monthLabel(month)}</option>
				{/each}
			</select>
		</div>

		{#if appState.selectedMonthStats}
			<div class="month-focus">
				<div>
					<span>Heures</span>
					<strong>{formatNumber(appState.selectedMonthStats.hours, 0)} h</strong>
				</div>
				<div>
					<span>Salaire net</span>
					<strong>{formatCurrency(appState.selectedMonthStats.netSalary)}</strong>
				</div>
				<div>
					<span>Indemnité estimée</span>
					<strong>{formatCurrency(appState.selectedMonthStats.estimatedIndemnity)}</strong>
				</div>
				<div>
					<span>Réel saisi</span>
					<strong>{formatCurrency(appState.selectedMonthStats.realIndemnity)}</strong>
				</div>
			</div>
		{/if}

		{#if appState.selectedMonthInfo}
			<div class="compact-form">
				<label>
					<span>Indemnisation réelle</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedMonthInfo.realIndemnity}
					/>
				</label>
				<label>
					<span>Congé spectacle</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedMonthInfo.congeSpectacle}
					/>
				</label>
				<label>
					<span>AJ réelle / notifiée</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedMonthInfo.dailyIndemnity}
					/>
				</label>
				<label class="wide">
					<span>Notes</span>
					<textarea rows="3" bind:value={appState.selectedMonthInfo.notes}></textarea>
				</label>
			</div>
		{/if}
	</section>

	<section class="panel declaration-panel">
		<div class="panel-heading">
			<h3>À déclarer pour {monthLabel(appState.selectedMonth)}</h3>
			<span class="panel-subtitle">{monthLabel(appState.selectedMonth)}</span>
		</div>

		{#if declarationContracts.length}
			<div class="declaration-list">
				<div class="declaration-header">
					<span>Structure</span>
					<span>Période</span>
					<span>Heures</span>
					<span>Cachets</span>
					<span>Salaire brut</span>
				</div>
				{#each declarationContracts as detail}
					<button
						type="button"
						class="declaration-row"
						onclick={() => openContract(detail.contract)}
					>
						<span class="company-list-title">
							<span
								class="company-swatch"
								style={`--company-color: ${appState.companyColor(detail.contract.companyId)}`}
								aria-hidden="true"
							></span>
							<strong>{appState.companyName(detail.contract.companyId)}</strong>
						</span>
						<span>
							{formatDeclarationDay(detail.periodStart)} /
							{formatDeclarationDay(detail.periodEnd)}
						</span>
						<span class="declaration-number">
							{detail.declaredHours > 0
								? `${formatNumber(detail.declaredHours, quantityDigits(detail.declaredHours))} h`
								: '-'}
						</span>
						<span class="declaration-number">
							{detail.declaredCachets > 0
								? formatNumber(detail.declaredCachets, quantityDigits(detail.declaredCachets))
								: '-'}
						</span>
						<strong class="declaration-number">{formatCurrency(detail.grossSalary)}</strong>
					</button>
				{/each}
			</div>
		{:else}
			<p class="empty">Aucun contrat à déclarer sur {monthLabel(appState.selectedMonth)}.</p>
		{/if}
	</section>

	<Calendar state={appState} panelClass="dashboard-calendar-panel" />
</section>
