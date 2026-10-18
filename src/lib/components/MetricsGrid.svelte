<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import { formatCurrency, formatNumber, formatPreciseCurrency } from '$lib/format';

	let { state }: { state: IntrState } = $props();
</script>

<section class="metrics-grid" aria-label="Indicateurs principaux">
	<div class="metric">
		<span>Heures période</span>
		<strong>{formatNumber(state.reference.hours, 0)} h</strong>
		<progress value={state.reference.hours} max={state.appData.settings.targetHours}></progress>
		<small>
			{formatNumber(state.reference.progress * 100, 0)} % des {state.appData.settings.targetHours} h
		</small>
	</div>
	<div class="metric">
		<span>Net total</span>
		<strong>{formatCurrency(state.totalNet)}</strong>
		<small>Brut {formatCurrency(state.totalGross)}</small>
	</div>
	<div class="metric">
		<span>Cotisations</span>
		<strong>{formatCurrency(state.totalContributions)}</strong>
		<small>
			{state.totalGross
				? formatNumber((state.totalContributions / state.totalGross) * 100, 1)
				: '0'}
			% moyen
		</small>
	</div>
	<div class="metric">
		<span>AJ estimée</span>
		<strong>{formatPreciseCurrency(state.dailyAllowance)}</strong>
		<small>Constantes modifiables</small>
	</div>
</section>
