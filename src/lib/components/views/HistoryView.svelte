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

	// Années qui ont des chiffres, de la plus ancienne à la plus récente, pour les graphiques d'argent.
	let moneyYears = $derived(
		[...history].reverse().filter((entry) => entry.totalIncome > 0 || entry.grossSalary > 0)
	);
	let maxIncome = $derived(Math.max(1, ...moneyYears.map((entry) => entry.totalIncome)));
	let maxGross = $derived(Math.max(1, ...moneyYears.map((entry) => entry.grossSalary)));
	let lastFull = $derived(history.find((entry) => !entry.year.isCurrent && entry.totalIncome > 0));
	let totalReceived = $derived(history.reduce((sum, entry) => sum + entry.totalIncome, 0));
	let hovered = $state('');
	// Détail affiché sous chaque graphique : l'année survolée, sinon la plus récente.
	function focusOf(prefix: string) {
		const key = hovered.startsWith(prefix) ? hovered.slice(prefix.length) : '';
		return moneyYears.find((entry) => entry.year.key === key) ?? moneyYears.at(-1);
	}
	let incomeFocus = $derived(focusOf('income:'));
	let grossFocus = $derived(focusOf('gross:'));

	const incomeParts = [
		{ key: 'netSalary', label: 'Net payé', color: '#1f9d89' },
		{ key: 'realIndemnity', label: 'ARE reçue', color: '#5d82e6' },
		{ key: 'congeSpectacle', label: 'Congés Spectacles', color: '#b8862a' }
	] as const;

	function share(part: number, total: number) {
		return total > 0 ? `${formatNumber((part / total) * 100, 0)} %` : '·';
	}

	function change(value: number | undefined) {
		if (value === undefined) return '·';
		const percent = Math.round(value * 100);
		return `${percent > 0 ? '+' : ''}${percent} %`;
	}

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

	function setConges(year: number, value: string) {
		const amount = Number(value.replace(',', '.'));
		const next = { ...(app.appData.settings.congesSpectaclesByYear ?? {}) };
		if (amount > 0) next[String(year)] = amount;
		else delete next[String(year)];
		app.appData.settings.congesSpectaclesByYear = next;
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

<section class="history-grid money" aria-label="Argent reçu et brut">
	<article class="panel tiles">
		<div class="tile">
			<span>Reçu depuis {moneyYears[0]?.year.year ?? '·'}</span>
			<strong>{formatCurrency(totalReceived)}</strong>
			<small>net payé, ARE et Congés Spectacles</small>
		</div>
		{#if lastFull}
			<div class="tile">
				<span>Reçu en {lastFull.year.year}</span>
				<strong>{formatCurrency(lastFull.totalIncome)}</strong>
				<small>{formatCurrency(lastFull.monthlyIncome)} par mois</small>
			</div>
			<div class="tile">
				<span>Part de l’ARE en {lastFull.year.year}</span>
				<strong>{share(lastFull.realIndemnity, lastFull.totalIncome)}</strong>
				<small
					>{formatCurrency(lastFull.realIndemnity)} sur {formatCurrency(
						lastFull.totalIncome
					)}</small
				>
			</div>
			<div class="tile">
				<span>Brut {lastFull.year.year}</span>
				<strong>{formatCurrency(lastFull.grossSalary)}</strong>
				<small
					>{change(lastFull.grossChange)} sur un an · {formatPreciseCurrency(lastFull.grossPerHour)} par
					heure</small
				>
			</div>
		{/if}
	</article>
</section>

<section class="history-grid charts">
	<section class="panel" aria-label="Argent reçu par année">
		<div class="panel-heading">
			<h3>Argent reçu par année</h3>
			<ul class="legend">
				{#each incomeParts as part (part.key)}
					<li><i style:background={part.color}></i>{part.label}</li>
				{/each}
			</ul>
		</div>
		<div class="bars">
			{#each moneyYears as entry (entry.year.key)}
				<button
					type="button"
					class="bar-column plain"
					aria-label={`${entry.year.year} : ${formatCurrency(entry.totalIncome)} reçus`}
					onmouseenter={() => (hovered = `income:${entry.year.key}`)}
					onmouseleave={() => (hovered = '')}
					onfocus={() => (hovered = `income:${entry.year.key}`)}
					onblur={() => (hovered = '')}
				>
					<div class="bar-track">
						<div class="stack" style:height={`${(entry.totalIncome / maxIncome) * 100}%`}>
							{#each incomeParts as part (part.key)}
								{#if entry[part.key] > 0}
									<div
										class="segment"
										style:background={part.color}
										style:flex-grow={entry[part.key]}
									></div>
								{/if}
							{/each}
						</div>
					</div>
					<strong>{formatCurrency(entry.totalIncome)}</strong>
					<span>{entry.year.year}</span>
				</button>
			{/each}
		</div>
		{#if incomeFocus}
			<p class="readout">
				<strong>{incomeFocus.year.year}{incomeFocus.year.isCurrent ? ' (en cours)' : ''}</strong>
				{#each incomeParts as part (part.key)}
					<span
						><i style:background={part.color}></i>{part.label}
						{formatCurrency(incomeFocus[part.key])}</span
					>
				{/each}
				<span>soit {formatCurrency(incomeFocus.monthlyIncome)} par mois</span>
			</p>
		{/if}
	</section>

	<section class="panel" aria-label="Évolution du brut">
		<div class="panel-heading">
			<h3>Évolution du brut</h3>
			<small class="muted">sous l’année : brut par heure</small>
		</div>
		<div class="bars">
			{#each moneyYears as entry (entry.year.key)}
				<button
					type="button"
					class="bar-column plain"
					aria-label={`${entry.year.year} : ${formatCurrency(entry.grossSalary)} brut`}
					onmouseenter={() => (hovered = `gross:${entry.year.key}`)}
					onmouseleave={() => (hovered = '')}
					onfocus={() => (hovered = `gross:${entry.year.key}`)}
					onblur={() => (hovered = '')}
				>
					<div class="bar-track">
						<div
							class="bar gross"
							class:current={entry.year.isCurrent}
							style:height={`${Math.max(2, (entry.grossSalary / maxGross) * 100)}%`}
						></div>
					</div>
					<strong>{formatCurrency(entry.grossSalary)}</strong>
					<span>{entry.year.year} · {formatNumber(entry.grossPerHour, 0)} €/h</span>
				</button>
			{/each}
		</div>
		{#if grossFocus}
			<p class="readout">
				<strong>{grossFocus.year.year}{grossFocus.year.isCurrent ? ' (en cours)' : ''}</strong>
				<span>Brut {formatCurrency(grossFocus.grossSalary)}</span>
				{#if grossFocus.grossChange !== undefined}
					<span>{change(grossFocus.grossChange)} sur un an</span>
				{/if}
				<span>{formatPreciseCurrency(grossFocus.grossPerHour)} par heure</span>
				<span>Coût employeur {formatCurrency(grossFocus.employerCost)}</span>
			</p>
		{/if}
	</section>
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
			{#if entry.annexes.annex8 || entry.annexes.annex10}
				<p class="annex-split">
					Annexe 10 (artiste) : {formatNumber(entry.annexes.annex10, 0)} h · Annexe 8 (technicien) : {formatNumber(
						entry.annexes.annex8,
						0
					)} h{#if entry.annexes.unknown}
						· emploi inconnu : {formatNumber(entry.annexes.unknown, 0)} h{/if}
				</p>
			{/if}

			<dl class="year-figures">
				<div>
					<dt>Contrats</dt>
					<dd>{entry.contracts}</dd>
				</div>
				<div>
					<dt>Cachets</dt>
					<dd>{formatNumber(entry.cachets, 0)}</dd>
				</div>
				<div>
					<dt>Brut</dt>
					<dd>{formatCurrency(entry.grossSalary)}</dd>
				</div>
				<div>
					<dt>Net</dt>
					<dd>{formatCurrency(entry.netSalary)}</dd>
				</div>
				<div>
					<dt>Cotisations</dt>
					<dd>{formatCurrency(entry.contributions)}</dd>
				</div>
				<div>
					<dt>ARE reçue</dt>
					<dd>{formatCurrency(entry.realIndemnity)}</dd>
				</div>
				<div>
					<dt>Congés Spectacles</dt>
					<dd>{formatCurrency(entry.congeSpectacle)}</dd>
				</div>
				<div class="sum">
					<dt>Reçu au total</dt>
					<dd>{formatCurrency(entry.totalIncome)}</dd>
				</div>
				<div class="sum">
					<dt>Par mois{entry.year.isCurrent ? ' (à date)' : ''}</dt>
					<dd>{formatCurrency(entry.monthlyIncome)}</dd>
				</div>
				<div>
					<dt>Brut par heure</dt>
					<dd>{formatPreciseCurrency(entry.grossPerHour)}</dd>
				</div>
				<div>
					<dt>Brut sur un an</dt>
					<dd>{change(entry.grossChange)}</dd>
				</div>
				<div>
					<dt>Coût employeur</dt>
					<dd>{formatCurrency(entry.employerCost)}</dd>
				</div>
				<div>
					<dt>Part de l’ARE</dt>
					<dd>{share(entry.realIndemnity, entry.totalIncome)}</dd>
				</div>
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
				<p class="annex-split">
					Premier employeur : {entry.employers[0].name}, {formatNumber(
						entry.topEmployerShare * 100,
						0
					)} % des heures
				</p>
				<details>
					<summary
						>{entry.employers.length} employeur{entry.employers.length > 1 ? 's' : ''}</summary
					>
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
			<label class="anniversary">
				<span>Indemnités Congés Spectacles de l’année</span>
				<input
					type="number"
					min="0"
					step="0.01"
					value={app.appData.settings.congesSpectaclesByYear?.[String(entry.year.year)] ?? ''}
					onchange={(event) =>
						setConges(entry.year.year, (event.currentTarget as HTMLInputElement).value)}
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

	.annex-split {
		margin: 6px 0 0;
		font-size: 13px;
		color: rgba(237, 241, 238, 0.68);
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

	.year-figures .sum dd {
		font-weight: 600;
	}

	.money {
		margin-bottom: 12px;
	}

	.tiles {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
		gap: 12px;
	}

	.tile {
		display: grid;
		gap: 2px;
	}

	.tile span,
	.tile small {
		color: #aab4af;
	}

	.tile strong {
		font-size: 24px;
		font-variant-numeric: tabular-nums;
	}

	.charts {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr));
		margin-bottom: 12px;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: #aab4af;
	}

	.legend i,
	.readout i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
		border-radius: 2px;
		vertical-align: -1px;
	}

	.bar-column.plain {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: default;
	}

	.bar-column:focus-visible {
		outline: 2px solid rgba(103, 216, 194, 0.6);
		outline-offset: 2px;
		border-radius: 4px;
	}

	.bar-column > strong {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.stack {
		display: flex;
		flex-direction: column-reverse;
		gap: 2px;
		width: 60%;
		max-width: 72px;
	}

	.segment {
		flex-basis: 0;
		min-height: 2px;
	}

	.stack .segment:last-child {
		border-radius: 4px 4px 0 0;
	}

	.bar.gross {
		background: #1f9d89;
	}

	.bar.gross.current {
		background: #dfad4a;
	}

	.readout {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 10px 0 0;
		font-size: 13px;
		color: #aab4af;
		font-variant-numeric: tabular-nums;
	}

	.readout strong {
		color: #edf1ee;
	}
</style>
