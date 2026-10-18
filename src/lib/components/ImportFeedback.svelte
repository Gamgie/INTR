<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';

	let { state }: { state: IntrState } = $props();
	let feedback = $derived(state.contractImportFeedback);
	let isBusy = $derived(feedback?.phase === 'importing' || feedback?.phase === 'undoing');
</script>

{#if feedback}
	<aside
		class="import-feedback"
		class:success={feedback.phase === 'success' || feedback.phase === 'undone'}
		class:warning={feedback.phase === 'partial'}
		class:error={feedback.phase === 'error'}
		class:busy={isBusy}
		aria-live="polite"
	>
		<header class="import-feedback-header">
			<span class="import-feedback-icon" aria-hidden="true">
				{#if isBusy}
					<span class="import-spinner"></span>
				{:else if feedback.phase === 'success'}
					<svg viewBox="0 0 24 24">
						<path d="m5 12.5 4.2 4.2L19 7" />
					</svg>
				{:else if feedback.phase === 'undone'}
					<svg viewBox="0 0 24 24">
						<path d="M9 8 5 12l4 4" />
						<path d="M5 12h8a5 5 0 1 1 0 10" />
					</svg>
				{:else}
					<svg viewBox="0 0 24 24">
						<path d="M12 8v5" />
						<path d="M12 17h.01" />
						<path
							d="M10.3 3.8 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.8a2 2 0 0 0-3.4 0Z"
						/>
					</svg>
				{/if}
			</span>

			<div class="import-feedback-copy">
				<span class="import-feedback-label">
					{feedback.phase === 'importing'
						? 'Import automatique'
						: feedback.phase === 'undoing'
							? 'Restauration'
							: 'Résultat de l’import'}
				</span>
				<strong>{feedback.title}</strong>
				<p>{feedback.summary}</p>
			</div>

			{#if !isBusy}
				<button
					class="import-feedback-close"
					type="button"
					aria-label="Fermer le récapitulatif"
					onclick={state.dismissContractImportFeedback}>×</button
				>
			{/if}
		</header>

		{#if isBusy}
			<div class="import-progress">
				<progress value={feedback.processed} max={Math.max(feedback.total, 1)}></progress>
				<span>{feedback.processed} / {feedback.total}</span>
			</div>
		{:else if feedback.items.length}
			<div class="import-stats" aria-label="Bilan de l’import">
				<span class="import-stat success-stat">
					{feedback.succeeded} fichier{feedback.succeeded > 1 ? 's traités' : ' traité'}
				</span>
				{#if feedback.contractsCreated}
					<span class="import-stat success-stat">
						{feedback.contractsCreated} contrat{feedback.contractsCreated > 1 ? 's créés' : ' créé'}
					</span>
				{/if}
				{#if feedback.contractUpdates}
					<span class="import-stat success-stat">
						{feedback.contractUpdates} mise{feedback.contractUpdates > 1 ? 's' : ''} à jour de contrat{feedback.contractUpdates >
						1
							? 's'
							: ''}
					</span>
				{/if}
				{#if feedback.documentsAdded}
					<span class="import-stat">
						{feedback.documentsAdded} document{feedback.documentsAdded > 1
							? 's ajoutés'
							: ' ajouté'}
					</span>
				{/if}
				{#if feedback.periodsUpdated}
					<span class="import-stat">
						{feedback.periodsUpdated} période{feedback.periodsUpdated > 1 ? 's mises' : ' mise'} à jour
					</span>
				{/if}
				{#if feedback.unchangedFiles}
					<span class="import-stat">
						{feedback.unchangedFiles} fichier{feedback.unchangedFiles > 1 ? 's' : ''} sans modification
					</span>
				{/if}
				{#if feedback.failed}
					<span class="import-stat error-stat">
						{feedback.failed} échec{feedback.failed > 1 ? 's' : ''}
					</span>
				{/if}
			</div>

			<div class="import-results">
				{#each feedback.items as item}
					<article class:error-item={item.status === 'error'} class="import-result">
						<span class="import-result-status" aria-hidden="true">
							{item.status === 'success' ? '✓' : '!'}
						</span>
						<div class="import-result-content">
							<strong title={item.fileName}>{item.fileName}</strong>
							<div class="import-result-meta">
								<span>{item.kind}</span>
								<span>{item.destination}</span>
							</div>
							{#if item.fields.length}
								<div class="import-field-list">
									{#each item.fields as field}
										<span>{field}</span>
									{/each}
								</div>
							{/if}
							{#each item.warnings as warning}
								<p class="import-warning">{warning}</p>
							{/each}
						</div>
					</article>
				{/each}
			</div>
		{/if}

		{#if !isBusy && feedback.phase !== 'undone'}
			<footer class="import-feedback-actions">
				{#if feedback.canUndo}
					<button class="import-undo" type="button" onclick={state.undoContractImport}>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 8 5 12l4 4" />
							<path d="M5 12h8a5 5 0 1 1 0 10" />
						</svg>
						Annuler l’import
					</button>
				{/if}
				<button class="import-dismiss" type="button" onclick={state.dismissContractImportFeedback}>
					Fermer
				</button>
			</footer>
		{/if}
	</aside>
{/if}
