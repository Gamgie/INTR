<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import DateInput from '$lib/components/DateInput.svelte';
	import { formatCurrency, formatDate, formatNumber, formatPreciseCurrency } from '$lib/format';
	import { buildYearHistory } from '$lib/history';

	let { state: app }: { state: IntrState } = $props();

	let history = $derived(buildYearHistory(app.appData));
	let maxHours = $derived(
		Math.max(app.appData.settings.targetHours || 507, ...history.map((entry) => entry.hours))
	);
	let target = $derived(app.appData.settings.targetHours || 507);

	const sourceLabel = { saisie: 'saisie', notification: 'notification ARE', estimée: 'estimée' };

	function anniversaryValue(year: number) {
		return app.appData.settings.anniversaries[String(year)] ?? '';
	}

	function setAnniversary(year: number, value: string) {
		const next = { ...app.appData.settings.anniversaries };
		if (value) next[String(year)] = value;
		else delete next[String(year)];
		app.appData.settings.anniversaries = next;
		app.touch();
	}

	function openYear(key: string, isCurrent: boolean) {
		app.selectPeriod(isCurrent ? '' : key);
		app.activeTab = 'pilotage';
	}
</script>

<section class="panel history-chart" aria-label="Heures par année d’intermittence">
	<div class="panel-heading">
		<h3>Heures par année d’intermittence</h3>
		<small class="muted">Trait : {target} h</small>
	</div>
	{#if history.length}
		<div class="bars">
			{#each [...history].reverse() as entry (entry.year.key)}
				<div class="bar-column">
					<div class="bar-track">
						<div class="bar-target" style:bottom={`${(target / maxHours) * 100}%`}></div>
						<div
							class="bar"
							class:reached={entry.hours >= target}
							class:current={entry.year.isCurrent}
							style:height={`${Math.max(2, (entry.hours / maxHours) * 100)}%`}
						></div>
					</div>
					<strong>{formatNumber(entry.hours, 0)} h</strong>
					<span>{entry.year.year}</span>
				</div>
			{/each}
		</div>
	{:else}
		<p class="muted">Aucun contrat pour le moment.</p>
	{/if}
</section>

<section class="history-grid">
	{#each history as entry (entry.year.key)}
		<article class="panel year-card" class:current={entry.year.isCurrent}>
			<div class="panel-heading">
				<h3>
					{entry.year.year}
					{#if entry.year.isCurrent}<span class="badge">en cours</span>{/if}
				</h3>
				<button type="button" onclick={() => openYear(entry.year.key, entry.year.isCurrent)}>
					Afficher
				</button>
			</div>
			<p class="muted">
				Du {formatDate(entry.year.start)} au {formatDate(entry.year.end)}
				· anniversaire {sourceLabel[entry.year.source]}
			</p>

			<div class="year-hours">
				<strong>{formatNumber(entry.hours, 0)} h</strong>
				<span>{formatNumber(entry.progress * 100, 0)} % des {target} h</span>
			</div>
			<progress value={entry.hours} max={target}></progress>

			<dl class="year-figures">
				<div><dt>Contrats</dt><dd>{entry.contracts}</dd></div>
				<div><dt>Cachets</dt><dd>{formatNumber(entry.cachets, 0)}</dd></div>
				<div><dt>Brut</dt><dd>{formatCurrency(entry.grossSalary)}</dd></div>
				<div><dt>Net</dt><dd>{formatCurrency(entry.netSalary)}</dd></div>
				<div><dt>Cotisations</dt><dd>{formatCurrency(entry.contributions)}</dd></div>
				<div><dt>ARE reçue</dt><dd>{formatCurrency(entry.realIndemnity)}</dd></div>
				<div><dt>Congés Spectacles</dt><dd>{formatCurrency(entry.congeSpectacle)}</dd></div>
				<div>
					<dt>AJ notifiée</dt>
					<dd>
						{entry.year.notification?.dailyAllowance
							? formatPreciseCurrency(entry.year.notification.dailyAllowance)
							: '·'}
					</dd>
				</div>
			</dl>

			{#if entry.employers.length}
				<details>
					<summary>{entry.employers.length} employeur{entry.employers.length > 1 ? 's' : ''}</summary>
					<ul class="employers">
						{#each entry.employers as employer (employer.name)}
							<li>
								<span>{employer.name}</span>
								<small>
									{formatNumber(employer.hours, 0)} h · {formatCurrency(employer.grossSalary)} ·
									{employer.contracts} contrat{employer.contracts > 1 ? 's' : ''}
								</small>
							</li>
						{/each}
					</ul>
				</details>
			{/if}

			<label class="anniversary">
				<span>Date anniversaire (fin de l’année)</span>
				<DateInput
					value={anniversaryValue(entry.year.year)}
					onchange={(value: string) => setAnniversary(entry.year.year, value)}
				/>
			</label>
		</article>
	{/each}
</section>

<style>
	.muted {
		margin: 0;
		color: #aab4af;
	}

	.history-chart {
		margin-bottom: 12px;
	}

	.bars {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		overflow-x: auto;
		padding-top: 8px;
	}

	.bar-column {
		display: grid;
		justify-items: center;
		gap: 4px;
		min-width: 56px;
		flex: 1 0 56px;
	}

	.bar-track {
		position: relative;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		width: 100%;
		height: 150px;
	}

	.bar-target {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px dashed rgba(223, 173, 74, 0.8);
	}

	.bar {
		width: 60%;
		max-width: 72px;
		border-radius: 4px 4px 0 0;
		background: rgba(170, 180, 175, 0.45);
	}

	.bar.reached {
		background: #26b19c;
	}

	.bar.current {
		background: #dfad4a;
	}

	.bar-column span {
		color: #aab4af;
		font-size: 12px;
	}

	.history-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 12px;
	}

	.year-card {
		display: grid;
		gap: 8px;
		align-content: start;
	}

	.year-card.current {
		border-color: rgba(223, 173, 74, 0.5);
	}

	.badge {
		margin-left: 6px;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(223, 173, 74, 0.18);
		color: #dfad4a;
		font-size: 12px;
		font-weight: 500;
	}

	.year-hours {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.year-hours strong {
		font-size: 24px;
	}

	.year-hours span {
		color: #aab4af;
	}

	.year-figures {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px 12px;
		margin: 0;
	}

	.year-figures div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.year-figures dt {
		color: #aab4af;
	}

	.year-figures dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.employers {
		display: grid;
		gap: 4px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
	}

	.employers li {
		display: grid;
		gap: 1px;
	}

	.employers small {
		color: #aab4af;
	}

	.anniversary {
		display: grid;
		gap: 4px;
	}
</style>
