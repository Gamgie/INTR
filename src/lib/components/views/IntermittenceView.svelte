<script lang="ts">
	import { base } from '$app/paths';

	import type { IntrState } from '$lib/app/state.svelte';
	import DateInput from '$lib/components/DateInput.svelte';
	import KdriveImport from '$lib/components/KdriveImport.svelte';
	import { formatCurrency, formatNumber, formatPreciseCurrency } from '$lib/format';
	import { ANNEXES, RULES } from '$lib/rules';
	import { estimateDailyAllowanceDetail } from '$lib/stats';

	let { state }: { state: IntrState } = $props();
	let allowanceDetail = $derived(
		state.reference.hours && state.reference.grossSalary
			? estimateDailyAllowanceDetail(state.appData)
			: null
	);
</script>

<section class="view-grid two-columns">
	<section class="panel">
		<div class="panel-heading">
			<h3>Paramètres {state.appData.settings.annex}</h3>
		</div>
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
							state.uploadAreNotification(event);
						}}
					/>
				</label>
			</div>
			{#if state.areUploadState}
				<p class="analysis-note">{state.areUploadState}</p>
			{/if}
			<div class="form-grid tight">
				<label class="wide">
					<span>Année d’intermittence active</span>
					<select
						value={state.appData.settings.activePeriodId}
						onchange={(event) => state.selectPeriod(event.currentTarget.value)}
					>
						<option value="">Global / sans compartiment</option>
						{#each state.appData.periods as period}
							<option value={period.id}>{period.label}</option>
						{/each}
					</select>
				</label>
				{#if state.activePeriod}
					<label>
						<span>Libellé</span>
						<input bind:value={state.activePeriod.label} />
					</label>
					<label>
						<span>Statut</span>
						<select bind:value={state.activePeriod.status}>
							<option value="Estimation">Estimation</option>
							<option value="Notifie">Notifié</option>
							<option value="Archive">Archivé</option>
						</select>
					</label>
					<label>
						<span>Admission</span>
						<DateInput bind:value={state.activePeriod.admissionDate} />
					</label>
					<label>
						<span>Début indemnisation</span>
						<DateInput bind:value={state.activePeriod.indemnizationStartDate} />
					</label>
					<label>
						<span>Date anniversaire</span>
						<DateInput bind:value={state.activePeriod.anniversaryDate} />
					</label>
					<label>
						<span>Allocation journalière</span>
						<input
							type="number"
							min="0"
							step="0.01"
							bind:value={state.activePeriod.dailyAllowance}
						/>
					</label>
					<label>
						<span>Référence début</span>
						<DateInput bind:value={state.activePeriod.referenceStartDate} />
					</label>
					<label>
						<span>Référence fin</span>
						<DateInput bind:value={state.activePeriod.referenceEndDate} />
					</label>
					<label>
						<span>Heures retenues</span>
						<input type="number" min="0" step="0.25" bind:value={state.activePeriod.hours} />
					</label>
					<label>
						<span>Salaire brut retenu</span>
						<input type="number" min="0" step="0.01" bind:value={state.activePeriod.grossSalary} />
					</label>
					<label>
						<span>Délai attente</span>
						<input type="number" min="0" step="1" bind:value={state.activePeriod.waitingDays} />
					</label>
					<label>
						<span>Franchise salaire</span>
						<input
							type="number"
							min="0"
							step="1"
							bind:value={state.activePeriod.salaryFranchiseDays}
						/>
					</label>
					<label>
						<span>Franchise congés</span>
						<input
							type="number"
							min="0"
							step="1"
							bind:value={state.activePeriod.congeFranchiseDays}
						/>
					</label>
					<label class="wide">
						<span>Notes période</span>
						<textarea rows="2" bind:value={state.activePeriod.notes}></textarea>
					</label>
					{#if state.activePeriod.sourceStoredName}
						<a
							class="wide ghost-button"
							href={`${base}/api/periods/${state.activePeriod.id}/document`}
							target="_blank"
							rel="noreferrer"
						>
							Vérifier le courrier source
						</a>
					{/if}
					<button
						class="wide danger"
						type="button"
						onclick={() => state.activePeriod && state.removePeriod(state.activePeriod.id)}
					>
						Supprimer cette notification ARE
					</button>
				{/if}
			</div>
		</div>

		<div class="formula-box">
			<span>{state.activePeriod ? `Synthèse ${state.activePeriod.label}` : 'Synthèse globale'}</span
			>
			<strong>
				{formatNumber(state.periodStats.hours, 0)} h · {formatCurrency(
					state.periodStats.grossSalary
				)}
				brut
			</strong>
			<small>
				{formatNumber(state.periodStats.contractCount, 1)} contrats · {formatCurrency(
					state.periodStats.netSalary
				)}
				net · {formatCurrency(state.periodStats.realIndemnity)} ARE réelle · {formatCurrency(
					state.periodStats.congeSpectacle
				)}
				congés spectacle
			</small>
		</div>

		<div class="month-focus">
			<div>
				<span>Total réel</span>
				<strong>{formatCurrency(state.periodStats.totalIncomeReal)}</strong>
			</div>
			<div>
				<span>Total estimé</span>
				<strong>{formatCurrency(state.periodStats.totalIncomeEstimated)}</strong>
			</div>
			<div>
				<span>Cotisations</span>
				<strong>
					{formatCurrency(state.periodStats.contributions)} · {formatNumber(
						state.periodStats.contributionRate,
						1
					)}
					%
				</strong>
			</div>
			<div>
				<span>Taux moyen brut</span>
				<strong>{formatPreciseCurrency(state.periodStats.grossHourlyRate)}</strong>
			</div>
		</div>

		<div class="form-grid tight">
			<label>
				<span>Début période référence</span>
				<DateInput bind:value={state.appData.settings.referenceStartDate} />
			</label>
			<label>
				<span>Objectif heures</span>
				<input type="number" min="0" step="1" bind:value={state.appData.settings.targetHours} />
			</label>
			<label>
				<span>AJ minimale</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={state.appData.settings.minDailyAllowance}
				/>
			</label>
			<label>
				<span>SMIC horaire brut</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={state.appData.settings.smicHourlyGross}
				/>
			</label>
			<label>
				<span>Annexe</span>
				<select bind:value={state.appData.settings.annex}>
					{#each ANNEXES as annex (annex)}
						<option value={annex}>{RULES[annex].label}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>PMSS</span>
				<input type="number" min="0" step="1" bind:value={state.appData.settings.pmss} />
			</label>
			<label>
				<span>Plafond cumul</span>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={state.appData.settings.cumulPmssMultiplier}
				/>
			</label>
		</div>

		<div class="formula-box">
			<span>Projection</span>
			<strong>{formatPreciseCurrency(state.dailyAllowance)} / jour</strong>
			{#if allowanceDetail && !state.activePeriod?.dailyAllowance}
				<small>
					A {formatPreciseCurrency(allowanceDetail.a)} + B {formatPreciseCurrency(allowanceDetail.b)} + C
					{formatPreciseCurrency(allowanceDetail.c)}
					{#if allowanceDetail.limitedBy === 'plancher'}
						· plancher {formatPreciseCurrency(allowanceDetail.floor)}
					{:else if allowanceDetail.limitedBy === 'plafond'}
						· plafond {formatPreciseCurrency(allowanceDetail.cap)}
					{/if}
				</small>
			{:else if state.activePeriod?.dailyAllowance}
				<small>Montant de la notification ARE</small>
			{/if}
			<small>
				{formatNumber(state.reference.hours, 0)} h · {formatCurrency(state.reference.grossSalary)} brut
				·
				{state.reference.contractCount} contrats
			</small>
		</div>

		<KdriveImport {state} />

		<div class="sync-card">
			<div class="panel-heading">
				<h3>Hébergement données</h3>
				<div class="button-row">
					<button type="button" onclick={state.cleanupUnusedFiles}>Clean fichiers</button>
				</div>
			</div>
			<p class="sync-note">
				Travail local, données distantes: une fois activée, la sauvegarde locale pousse le JSON et
				les uploads vers le serveur hébergé.
			</p>
			{#if state.cleanupFilesState}
				<p class="analysis-note">{state.cleanupFilesState}</p>
			{/if}
			<div class="form-grid tight">
				<label class="wide">
					<span>URL serveur</span>
					<input bind:value={state.appData.settings.remoteBaseUrl} />
				</label>
				<label>
					<span>Synchro distante</span>
					<select bind:value={state.appData.settings.remoteSyncEnabled}>
						<option value={false}>Non</option>
						<option value={true}>Oui</option>
					</select>
				</label>
				<label>
					<span>Dernière synchro</span>
					<input readonly value={state.appData.settings.remoteLastSyncAt || 'Jamais'} />
				</label>
				<label class="wide">
					<span>Statut serveur</span>
					<textarea rows="2" bind:value={state.appData.settings.remoteLastSyncStatus}></textarea>
				</label>
			</div>
		</div>

		<div class="sync-card">
			<div class="panel-heading">
				<h3>Transat-GHS</h3>
				<button
					type="button"
					onclick={state.checkGhsSync}
					disabled={state.syncState === 'checking'}
				>
					{state.syncState === 'checking' ? 'Vérification...' : 'Tester'}
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
					<input type="email" bind:value={state.appData.settings.transatEmail} />
				</label>
				<label>
					<span>Synchro active</span>
					<select bind:value={state.appData.settings.ghsSyncEnabled}>
						<option value={false}>Non</option>
						<option value={true}>Oui</option>
					</select>
				</label>
				<label class="wide">
					<span>URL API GHS</span>
					<input
						placeholder="Fourni par GHS / partenaire"
						bind:value={state.appData.settings.ghsApiBaseUrl}
					/>
				</label>
				<label class="wide">
					<span>Jeton API GHS</span>
					<input type="password" bind:value={state.appData.settings.ghsApiToken} />
				</label>
				<label class="wide">
					<span>Dernier statut</span>
					<textarea rows="3" bind:value={state.appData.settings.ghsLastSyncStatus}></textarea>
				</label>
			</div>
		</div>
	</section>

	<section class="panel">
		<div class="panel-heading">
			<h3>Contrats à venir</h3>
			<button type="button" title="Ajouter un contrat à venir" onclick={state.addFutureContract}
				>+</button
			>
		</div>

		<div class="future-list">
			{#each state.appData.futureContracts as future}
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
								onclick={() => state.removeFutureContract(future)}
							>
								Supprimer
							</button>
						</div>
					</div>
				</article>
			{/each}
			{#if state.appData.futureContracts.length === 0}
				<p class="empty">Aucun contrat à venir.</p>
			{/if}
		</div>
	</section>
</section>
