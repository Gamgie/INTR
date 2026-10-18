<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import { ALL_YEARS, yearLabel } from '$lib/years';

	let { state: app, label = 'Année d’intermittence' }: { state: IntrState; label?: string } =
		$props();

	let current = $derived(app.years.find((year) => year.isCurrent));
	let selectValue = $derived(
		app.selectedYear && current && app.selectedYear.year === current.year
			? ''
			: app.appData.settings.activePeriodId
	);
</script>

<label class="period-picker">
	<span>{label}</span>
	<select value={selectValue} onchange={(event) => app.selectPeriod(event.currentTarget.value)}>
		{#if current}
			<option value="">En cours · {yearLabel(current)}</option>
		{/if}
		{#each app.years.filter((year) => !year.isCurrent && !year.isFuture) as year (year.key)}
			<option value={year.key}>{yearLabel(year)}</option>
		{/each}
		<option value={ALL_YEARS}>Toutes les années</option>
	</select>
</label>
