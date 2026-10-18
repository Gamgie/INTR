<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import { formatCurrency, formatDate, formatNumber } from '$lib/format';
	import { buildMonthlyContractBreakdown, currentMonthKey, monthLabel } from '$lib/stats';
	import type { Contract, IntermittencePeriod } from '$lib/types';

	type CalendarMode = 'month' | 'year';

	let {
		state: appState,
		title = 'Calendrier',
		panelClass = ''
	}: { state: IntrState; title?: string; panelClass?: string } = $props();

	let calendarMode = $state<CalendarMode>('month');
	let calendarMonth = $state(currentMonthKey());

	const weekdayLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
	const monthTitleFormatter = new Intl.DateTimeFormat('fr-FR', {
		month: 'long',
		year: 'numeric'
	});

	let monthlyStatsByMonth = $derived(
		new Map(appState.monthlyStats.map((stats) => [stats.month, stats]))
	);

	let yearMonths = $derived.by(() =>
		Array.from(
			{ length: 12 },
			(_, index) => `${calendarYear()}-${String(index + 1).padStart(2, '0')}`
		)
	);

	let calendarDays = $derived.by(() => buildCalendarDays(calendarMonth));
	let calendarMonthAnniversaries = $derived.by(() => anniversariesForMonth(calendarMonth));

	let anniversariesByDate = $derived.by(() => {
		const grouped = new Map<string, IntermittencePeriod[]>();

		for (const period of appState.appData.periods) {
			if (!period.anniversaryDate) continue;
			grouped.set(period.anniversaryDate, [...(grouped.get(period.anniversaryDate) ?? []), period]);
		}

		return grouped;
	});

	$effect(() => {
		if (appState.selectedMonth && appState.selectedMonth !== calendarMonth) {
			calendarMonth = appState.selectedMonth;
		}
	});

	function parseDate(value: string) {
		const date = new Date(`${value}T00:00:00`);
		return Number.isNaN(date.getTime()) ? undefined : date;
	}

	function isoDate(date: Date) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
	}

	function calendarYear() {
		return calendarMonth.slice(0, 4) || String(new Date().getFullYear());
	}

	function monthTitle(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month;
		return monthTitleFormatter.format(new Date(year, monthNumber - 1, 1));
	}

	function selectCalendarMonth(month: string) {
		calendarMonth = month;
		appState.selectMonth(month);
	}

	function shiftMonth(offset: number) {
		const [year, monthNumber] = calendarMonth.split('-').map(Number);
		const source = new Date(year || new Date().getFullYear(), (monthNumber || 1) - 1, 1);
		source.setMonth(source.getMonth() + offset);
		selectCalendarMonth(
			`${source.getFullYear()}-${String(source.getMonth() + 1).padStart(2, '0')}`
		);
	}

	function shiftCalendar(offset: number) {
		if (calendarMode === 'year') {
			selectCalendarMonth(
				`${Number(calendarYear()) + offset}-${calendarMonth.slice(5, 7) || '01'}`
			);
			return;
		}

		shiftMonth(offset);
	}

	function calendarPeriodLabel() {
		return calendarMode === 'year' ? calendarYear() : monthTitle(calendarMonth);
	}

	function contractsForDay(dayIso: string) {
		const day = parseDate(dayIso);
		if (!day) return [];

		return appState.appData.contracts
			.filter((contract) => {
				const start = parseDate(contract.startDate);
				if (!start) return false;
				const end = parseDate(contract.endDate) ?? start;
				return day >= start && day <= end;
			})
			.sort(
				(left, right) =>
					(left.startDate || '').localeCompare(right.startDate || '') ||
					left.title.localeCompare(right.title)
			);
	}

	function anniversariesForDay(dayIso: string) {
		return anniversariesByDate.get(dayIso) ?? [];
	}

	function anniversariesForMonth(month: string) {
		return appState.appData.periods.filter(
			(period) => period.anniversaryDate.slice(0, 7) === month
		);
	}

	function contractBlockLabel(contract: Contract) {
		const projectName = appState.projectName(contract.projectId);
		const companyName = appState.companyName(contract.companyId);
		return projectName !== 'Sans projet'
			? `${projectName} · ${companyName}`
			: `${contract.title} · ${companyName}`;
	}

	function buildCalendarDays(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		const today = isoDate(new Date());
		const firstDay = new Date(year || new Date().getFullYear(), (monthNumber || 1) - 1, 1);
		const start = new Date(firstDay);
		start.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));

		return Array.from({ length: 42 }, (_, index) => {
			const date = new Date(start);
			date.setDate(start.getDate() + index);
			const iso = isoDate(date);
			const anniversaries = anniversariesForDay(iso);
			return {
				iso,
				day: date.getDate(),
				month: iso.slice(0, 7),
				isCurrentMonth: date.getMonth() === firstDay.getMonth(),
				isToday: iso === today,
				isAnniversary: anniversaries.length > 0,
				anniversaries,
				contracts: contractsForDay(iso)
			};
		});
	}

	function monthContracts(month: string) {
		return buildMonthlyContractBreakdown(appState.appData, month);
	}

	function openContract(contract: Contract) {
		appState.selectedContractId = contract.id;
		appState.activeTab = 'contrats';
	}

	function openMonth(month: string) {
		selectCalendarMonth(month);
		calendarMode = 'month';
	}
</script>

<section class={`panel ${panelClass}`.trim()}>
	<div class="panel-heading">
		<h3>{title}</h3>
		<div class="calendar-controls">
			<div class="status-row">
				<button
					type="button"
					class:active={calendarMode === 'month'}
					onclick={() => (calendarMode = 'month')}
				>
					Mois
				</button>
				<button
					type="button"
					class:active={calendarMode === 'year'}
					onclick={() => (calendarMode = 'year')}
				>
					Année
				</button>
			</div>
			<div class="calendar-nav">
				<button type="button" title="Précédent" onclick={() => shiftCalendar(-1)}>&lt;</button>
				<button type="button" title="Suivant" onclick={() => shiftCalendar(1)}>&gt;</button>
			</div>
			<strong class="calendar-current-label">{calendarPeriodLabel()}</strong>
		</div>
	</div>

	{#if calendarMode === 'month'}
		<div class="calendar-month-title">
			<strong>{monthTitle(calendarMonth)}</strong>
			<span>
				{monthContracts(calendarMonth).length} contrat(s) ·
				{formatNumber(monthlyStatsByMonth.get(calendarMonth)?.hours ?? 0, 0)} h ·
				{formatCurrency(monthlyStatsByMonth.get(calendarMonth)?.netSalary ?? 0)}
				{#if calendarMonthAnniversaries.length}
					· anniversaire(s) {calendarMonthAnniversaries
						.map((period) => formatDate(period.anniversaryDate))
						.join(', ')}
				{/if}
			</span>
		</div>

		<div class="calendar-grid">
			{#each weekdayLabels as label}
				<div class="calendar-weekday">{label}</div>
			{/each}
			{#each calendarDays as day}
				<button
					type="button"
					class="calendar-day"
					class:outside={!day.isCurrentMonth}
					class:today={day.isToday}
					class:anniversary={day.isAnniversary}
					onclick={() => {
						if (!day.isCurrentMonth) selectCalendarMonth(day.month);
					}}
				>
					<span class="calendar-day-number">{day.day}</span>
					<div class="calendar-day-contracts">
						{#each day.anniversaries as period}
							<span class="calendar-anniversary-chip">Anniversaire · {period.label}</span>
						{/each}
						{#each day.contracts.slice(0, 3) as contract}
							<span
								class="calendar-contract-chip"
								data-status={contract.status}
								style={`--company-color: ${appState.companyColor(contract.companyId)}`}
								role="button"
								tabindex="0"
								onclick={(event) => {
									event.stopPropagation();
									openContract(contract);
								}}
								onkeydown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										event.stopPropagation();
										openContract(contract);
									}
								}}
							>
								{contractBlockLabel(contract)}
							</span>
						{/each}
						{#if day.contracts.length > 3}
							<span class="calendar-more">+{day.contracts.length - 3}</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{:else}
		<div class="calendar-year-grid">
			{#each yearMonths as month}
				{@const stats = monthlyStatsByMonth.get(month)}
				{@const contracts = monthContracts(month)}
				{@const anniversaries = anniversariesForMonth(month)}
				<button
					type="button"
					class="calendar-month-card"
					class:selected={appState.selectedMonth === month}
					onclick={() => openMonth(month)}
				>
					<strong>{monthLabel(month)}</strong>
					<span>
						{formatNumber(stats?.hours ?? 0, 0)} h · {formatCurrency(stats?.netSalary ?? 0)}
					</span>
					{#each anniversaries as period}
						<i class="calendar-anniversary-text">
							Anniversaire {formatDate(period.anniversaryDate)}
						</i>
					{/each}
					<i>{contracts.length} contrat(s)</i>
					<div class="calendar-month-bars" aria-hidden="true">
						{#each contracts.slice(0, 8) as detail}
							<span
								data-status={detail.contract.status}
								style={`--company-color: ${appState.companyColor(detail.contract.companyId)}`}
							></span>
						{/each}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</section>
