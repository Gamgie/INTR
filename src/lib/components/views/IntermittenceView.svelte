<script lang="ts">
	import { base } from '$app/paths';

	import type { IntrState } from '$lib/app/state.svelte';
	import DateInput from '$lib/components/DateInput.svelte';
	import KdriveImport from '$lib/components/KdriveImport.svelte';
	import YearPicker from '$lib/components/YearPicker.svelte';
	import { formatCurrency, formatNumber, formatPreciseCurrency } from '$lib/format';
	import { annexSplit } from '$lib/annex';
	import { ANNEXES, RULES } from '$lib/rules';
	import { yearOfDate } from '$lib/years';
	import { estimateDailyAllowanceDetail } from '$lib/stats';

	let { state: app }: { state: IntrState } = $props();
	let allowanceDetail = $derived(
		app.reference.hours && app.reference.grossSalary
			? estimateDailyAllowanceDetail(app.appData)
			: null
	);
	// Heures de l'année choisie par annexe, d'après l'emploi de chaque contrat.
	let split = $derived(
		annexSplit(
			app.appData.contracts.filter(
				(contract) => yearOfDate(app.appData, contract.startDate) === app.selectedYear?.year
			)
		)
	);
	let suggested = $derived(split.lastAnnex || split.majority);

	// Section des notifications ARE repliable ; l'état ouvert ou fermé est gardé sur l'appareil.
	const NOTIFICATION_OPEN_KEY = 'intr-notification-ouverte';
	let notificationOpen = $state(readNotificationOpen());

	function readNotificationOpen() {
		try {
			return globalThis.localStorage?.getItem(NOTIFICATION_OPEN_KEY) === '1';
		} catch {
			return false;
		}
	}

	function rememberNotificationOpen(open: boolean) {
		notificationOpen = open;
		try {
			globalThis.localStorage?.setItem(NOTIFICATION_OPEN_KEY, open ? '1' : '0');
		} catch {
			// Stockage indisponible : l'état reste celui de la session.
		}
	}
</script>

<section class="view-grid two-columns">
	<section class="panel">
		<div class="panel-heading">
			<h3>Paramètres {app.appData.settings.annex}</h3>
		</div>
		<div class="formula-box">
			<span>{app.activeNotification ? `Synthèse ${app.activeNotification.label}` : 'Synthèse globale'}</span
			>
			<strong>
				{formatNumber(app.periodStats.hours, 0)} h · {formatCurrency(
					app.periodStats.grossSalary
				)}
				brut
			</strong>
			<small>
				{formatNumber(app.periodStats.contractCount, 1)} contrats · {formatCurrency(
					app.periodStats.netSalary
				)}
				net · {formatCurrency(app.periodStats.realIndemnity)} ARE réelle · {formatCurrency(
					app.periodStats.congeSpectacle
				)}
				congés spectacle
			</small>
		</div>

		<div class="month-focus">
			<div>
				<span>Total réel</span>
				<strong>{formatCurrency(app.periodStats.totalIncomeReal)}</strong>
			</div>
			<div>
				<span>Total estimé</span>
				<strong>{formatCurrency(app.periodStats.totalIncomeEstimated)}</strong>
			</div>
			<div>
				<span>Cotisations</span>
				<strong>
					{formatCurrency(app.periodStats.contributions)} · {formatNumber(
						app.periodStats.contributionRate,
						1
					)}
					%
				</strong>
			</div>
			<div>
				<span>Taux moyen brut</span>
				<strong>{formatPreciseCurrency(app.periodStats.grossHourlyRate)}</strong>
			</div>
		</div>

		<div class="form-grid tight">
			<label>
				<span>Début période référence</span>
				<DateInput bind:value={app.appData.settings.referenceStartDate} />
			</label>
			<label>
				<span>Objectif heures</span>
				<input type="number" min="0" step="1" bind:value={app.appData.settings.targetHours} />
			</label>
			<label>
				<span>AJ minimale</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={app.appData.settings.minDailyAllowance}
				/>
			</label>
			<label>
				<span>SMIC horaire brut</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={app.appData.settings.smicHourlyGross}
				/>
			</label>
			<label>
				<span>Annexe</span>
				<select bind:value={app.appData.settings.annex}>
					{#each ANNEXES as annex (annex)}
						<option value={annex}>{RULES[annex].label}</option>
					{/each}
				</select>
				<small class="annex-hint">
					Année {app.selectedYear?.year ?? ""} : {formatNumber(split.annex10, 0)} h en annexe 10
					(artiste), {formatNumber(split.annex8, 0)} h en annexe 8 (technicien){#if split.unknown}, {formatNumber(split.unknown, 0)} h d’emploi inconnu{/if}.
					{#if split.lastAnnex}Dernier contrat : {split.lastAnnex.toLowerCase()}.{/if}
				</small>
				{#if suggested && suggested !== app.appData.settings.annex}
					<button
						type="button"
						class="ghost-button"
						onclick={() => {
							app.appData.settings.annex = suggested as typeof app.appData.settings.annex;
							app.touch();
						}}
					>
						Passer en {suggested.toLowerCase()}
					</button>
				{/if}
			</label>
			<label>
				<span>PMSS</span>
				<input type="number" min="0" step="1" bind:value={app.appData.settings.pmss} />
			</label>
			<label>
				<span>Plafond cumul</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={app.appData.settings.cumulPmssMultiplier}
				/>
			</label>
		</div>

		<div class="formula-box">
			<span>Projection</span>
			<strong>{formatPreciseCurrency(app.dailyAllowance)} / jour</strong>
			{#if allowanceDetail && !app.activeNotification?.dailyAllowance}
				<small>
					A {formatPreciseCurrency(allowanceDetail.a)} + B {formatPreciseCurrency(allowanceDetail.b)} + C
					{formatPreciseCurrency(allowanceDetail.c)}
					{#if allowanceDetail.limitedBy === 'plancher'}
						· plancher {formatPreciseCurrency(allowanceDetail.floor)}
					{:else if allowanceDetail.limitedBy === 'plafond'}
						· plafond {formatPreciseCurrency(allowanceDetail.cap)}
					{/if}
				</small>
			{:else if app.activeNotification?.dailyAllowance}
				<small>Montant de la notification ARE</small>
			{/if}
			<small>
				{formatNumber(app.reference.hours, 0)} h · {formatCurrency(app.reference.grossSalary)} brut
				·
				{app.reference.contractCount} contrats
			</small>
		</div>

		<KdriveImport state={app} />

		<div class="sync-card">
			<div class="panel-heading">
				<h3>Hébergement données</h3>
				<div class="button-row">
					<button type="button" onclick={app.cleanupUnusedFiles}>Clean fichiers</button>
				</div>
			</div>
			<p class="sync-note">
				Travail local, données distantes: une fois activée, la sauvegarde locale pousse le JSON et
				les uploads vers le serveur hébergé.
			</p>
			{#if app.cleanupFilesState}
				<p class="analysis-note">{app.cleanupFilesState}</p>
			{/if}
			<div class="form-grid tight">
				<label class="wide">
					<span>URL serveur</span>
					<input bind:value={app.appData.settings.remoteBaseUrl} />
				</label>
				<label>
					<span>Synchro distante</span>
					<select bind:value={app.appData.settings.remoteSyncEnabled}>
						<option value={false}>Non</option>
						<option value={true}>Oui</option>
					</select>
				</label>
				<label>
					<span>Dernière synchro</span>
					<input readonly value={app.appData.settings.remoteLastSyncAt || 'Jamais'} />
				</label>
				<label class="wide">
					<span>Statut serveur</span>
					<textarea rows="2" bind:value={app.appData.settings.remoteLastSyncStatus}></textarea>
				</label>
			</div>
		</div>

		<div class="sync-card">
			<div class="panel-heading">
				<h3>Transat-GHS</h3>
				<button
					type="button"
					onclick={app.checkGhsSync}
					disabled={app.syncState === 'checking'}
				>
					{app.syncState === 'checking' ? 'Vérification...' : 'Tester'}
				</button>
			</div>
			<p class="sync-note">
				GHS propose des APIs Contrats/Paies activables en option. La synchro automatique nécessite
				les identifiants API fournis par GHS; l’app ne tente pas de se connecter à Transat avec ton
				mot de passe.
			</p>
			<div class="form-grid tight">
				<label>
					<span>Email Transat</span>
					<input type="email" bind:value={app.appData.settings.transatEmail} />
				</label>
				<label>
					<span>Synchro active</span>
					<select bind:value={app.appData.settings.ghsSyncEnabled}>
						<option value={false}>Non</option>
						<option value={true}>Oui</option>
					</select>
				</label>
				<label class="wide">
					<span>URL API GHS</span>
					<input
						placeholder="Fourni par GHS / partenaire"
						bind:value={app.appData.settings.ghsApiBaseUrl}
					/>
				</label>
				<label class="wide">
					<span>Jeton API GHS</span>
					<input type="password" bind:value={app.appData.settings.ghsApiToken} />
				</label>
				<label class="wide">
					<span>Dernier statut</span>
					<textarea rows="3" bind:value={app.appData.settings.ghsLastSyncStatus}></textarea>
				</label>
			</div>
		</div>
	</section>

	<section class="panel">
		<div class="panel-heading">
			<h3>Contrats à venir</h3>
			<button type="button" title="Ajouter un contrat à venir" onclick={app.addFutureContract}
				>+</button
			>
		</div>

		<div class="future-list">
			{#each app.appData.futureContracts as future}
				<article class="future-item">
					<div class="form-grid tight">
						<label class="wide">
							<span>Compagnie</span>
							<input bind:value={future.companyName} />
						</label>
						<label>
							<span>Montant</span>
							<input type="number" min="0" step="0.01" bind:value={future.amount} />
						</label>
						<label>
							<span>Type</span>
							<select bind:value={future.amountType}>
								<option value="employerCost">Coût employeur</option>
								<option value="gross">Brut</option>
								<option value="net">Net</option>
							</select>
						</label>
						<label>
							<span>Heures estimées</span>
							<input type="number" min="0" step="0.25" bind:value={future.estimatedHours} />
						</label>
						<label class="wide">
							<span>Notes</span>
							<textarea rows="2" bind:value={future.notes}></textarea>
						</label>
						<div class="button-row wide">
							<button
								class="danger"
								type="button"
								onclick={() => app.removeFutureContract(future)}
							>
								Supprimer
							</button>
						</div>
					</div>
				</article>
			{/each}
			{#if app.appData.futureContracts.length === 0}
				<p class="empty">Aucun contrat à venir.</p>
			{/if}
		</div>
	</section>
</section>

<section class="panel notification-panel">
	<details
		class="notification-toggle"
		open={notificationOpen}
		ontoggle={(event) => rememberNotificationOpen((event.currentTarget as HTMLDetailsElement).open)}
	>
		<summary>
			<h3>Notification ARE de l’année</h3>
			<small>
				{app.activeNotification
					? `${app.activeNotification.label} · AJ ${formatPreciseCurrency(app.activeNotification.dailyAllowance)}`
					: 'Aucune notification pour cette année'}
			</small>
		</summary>
		<div class="search-box">
			<div class="panel-heading">
				<h4>Historique intermittence</h4>
				<label class="file-button" title="Analyser une notification ARE">
					Notification ARE
					<input
						type="file"
						accept=".pdf,.txt,.md,application/pdf,text/*"
						onchange={(event) => {
							event.stopPropagation();
							app.uploadAreNotification(event);
						}}
					/>
				</label>
			</div>
			{#if app.areUploadState}
				<p class="analysis-note">{app.areUploadState}</p>
			{/if}
			<div class="form-grid tight">
				<div class="wide">
					<YearPicker state={app} label="Année d’intermittence affichée" />
				</div>
				{#if !app.activeNotification && app.selectedYear}
					<p class="wide analysis-note">
						Aucune notification ARE pour l’année {app.selectedYear.year}. Importe-la pour
						utiliser l’allocation notifiée dans les calculs.
					</p>
				{/if}
				{#if app.activeNotification}
					<label>
						<span>Libellé</span>
						<input bind:value={app.activeNotification.label} />
					</label>
					<label>
						<span>Statut</span>
						<select bind:value={app.activeNotification.status}>
							<option value="Estimation">Estimation</option>
							<option value="Notifie">Notifié</option>
							<option value="Archive">Archivé</option>
						</select>
					</label>
					<label>
						<span>Admission</span>
						<DateInput bind:value={app.activeNotification.admissionDate} />
					</label>
					<label>
						<span>Début indemnisation</span>
						<DateInput bind:value={app.activeNotification.indemnizationStartDate} />
					</label>
					<label>
						<span>Date anniversaire</span>
						<DateInput bind:value={app.activeNotification.anniversaryDate} />
					</label>
					<label>
						<span>Allocation journalière</span>
						<input
							type="number"
							min="0"
							step="0.01"
							bind:value={app.activeNotification.dailyAllowance}
						/>
					</label>
					<label>
						<span>Référence début</span>
						<DateInput bind:value={app.activeNotification.referenceStartDate} />
					</label>
					<label>
						<span>Référence fin</span>
						<DateInput bind:value={app.activeNotification.referenceEndDate} />
					</label>
					<label>
						<span>Heures retenues</span>
						<input type="number" min="0" step="0.25" bind:value={app.activeNotification.hours} />
					</label>
					<label>
						<span>Salaire brut retenu</span>
						<input type="number" min="0" step="0.01" bind:value={app.activeNotification.grossSalary} />
					</label>
					<label>
						<span>Délai attente</span>
						<input type="number" min="0" step="1" bind:value={app.activeNotification.waitingDays} />
					</label>
					<label>
						<span>Franchise salaire</span>
						<input
							type="number"
							min="0"
							step="1"
							bind:value={app.activeNotification.salaryFranchiseDays}
						/>
					</label>
					<label>
						<span>Franchise congés</span>
						<input
							type="number"
							min="0"
							step="1"
							bind:value={app.activeNotification.congeFranchiseDays}
						/>
					</label>
					<label class="wide">
						<span>Notes période</span>
						<textarea rows="2" bind:value={app.activeNotification.notes}></textarea>
					</label>
					{#if app.activeNotification.sourceStoredName}
						<a
							class="wide ghost-button"
							href={`${base}/api/periods/${app.activeNotification.id}/document`}
							target="_blank"
							rel="noreferrer"
						>
							Vérifier le courrier source
						</a>
					{/if}
					<button
						class="wide danger"
						type="button"
						onclick={() => app.activeNotification && app.removePeriod(app.activeNotification.id)}
					>
						Supprimer cette notification ARE
					</button>
				{/if}
			</div>
		</div>
	</details>
</section>

<style>
	.notification-panel {
		margin-top: 16px;
	}

	.notification-toggle > summary {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		cursor: pointer;
		list-style: none;
	}

	.notification-toggle > summary::-webkit-details-marker {
		display: none;
	}

	.notification-toggle > summary::before {
		content: '▸';
		display: inline-block;
		transition: transform 160ms ease;
	}

	.notification-toggle[open] > summary::before {
		transform: rotate(90deg);
	}

	.notification-toggle > summary h3 {
		margin: 0;
	}

	.notification-toggle > summary small {
		color: rgba(237, 241, 238, 0.68);
	}

	.notification-toggle[open] > summary {
		margin-bottom: 12px;
	}

	.annex-hint {
		color: rgba(237, 241, 238, 0.68);
		line-height: 1.4;
	}
</style>
