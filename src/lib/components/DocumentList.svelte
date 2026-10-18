<script lang="ts">
	import { base } from '$app/paths';

	import { documentKinds, type IntrState } from '$lib/app/state.svelte';
	import { formatNumber } from '$lib/format';
	import type { Contract, DocumentKind } from '$lib/types';

	let { contract, state }: { contract: Contract; state: IntrState } = $props();
</script>

<section class="documents">
	<div class="panel-heading inline">
		<h4>Documents</h4>
		<div class="upload-row">
			{#each documentKinds as kind}
				<label class="file-button" title={`Ajouter ${kind}`}>
					{kind}
					<input
						type="file"
						accept=".pdf,.txt,.csv,.md,application/pdf,text/*"
						onchange={(event) => {
							event.stopPropagation();
							state.uploadDocument(contract, event, kind);
						}}
					/>
				</label>
			{/each}
		</div>
	</div>
	{#if state.uploadState[contract.id]}
		<p class="analysis-note">{state.uploadState[contract.id]}</p>
	{/if}

	<div class="document-list">
		{#each state.documentsFor(contract) as document}
			<article class="document-item">
				<div class="document-main">
					<select
						class="document-kind-select"
						value={document.kind}
						aria-label={`Type de document pour ${document.fileName}`}
						onchange={(event) =>
							state.changeDocumentKind(document, event.currentTarget.value as DocumentKind)}
					>
						{#each documentKinds as kind}
							<option value={kind}>{kind}</option>
						{/each}
					</select>
					<span>
						{document.fileName} · {formatNumber(document.size / 1024, 1)} Ko
						{#if document.pageStart && document.pageEnd && document.pageEnd > 1}
							· pages {document.pageStart}-{document.pageEnd}
						{/if}
					</span>
				</div>
				<a href={`${base}/api/documents/${document.id}`} target="_blank" rel="noreferrer">Ouvrir</a>
				{#if Object.keys(document.extractedFields).length}
					<button
						type="button"
						title="Appliquer les champs détectés"
						onclick={() => state.applyFields(contract, document.extractedFields)}
					>
						Appliquer
					</button>
				{/if}
				<button
					class="danger"
					type="button"
					title={`Supprimer ${document.fileName}`}
					aria-label={`Supprimer le document ${document.fileName}`}
					disabled={state.deletingDocumentIds[document.id]}
					onclick={() => state.removeDocument(document)}
				>
					{state.deletingDocumentIds[document.id] ? 'Suppression...' : 'Supprimer'}
				</button>
				{#if document.extractedTextPreview}
					<details>
						<summary>Texte extrait</summary>
						<pre>{document.extractedTextPreview}</pre>
					</details>
				{/if}
			</article>
		{/each}
		{#if state.documentsFor(contract).length === 0}
			<p class="empty">Aucun document attaché.</p>
		{/if}
	</div>
</section>
