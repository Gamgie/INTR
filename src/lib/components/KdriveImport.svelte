<script lang="ts">
	import { untrack } from 'svelte';

	import { base } from '$app/paths';

	import type { IntrState } from '$lib/app/state.svelte';
	import type { AppData } from '$lib/types';

	type SourceFile = {
		id: number;
		name: string;
		path: string;
		group: string;
		size: number;
		importable: boolean;
		status: '' | 'importé' | 'erreur';
		message: string;
	};

	let { state: app }: { state: IntrState } = $props();

	// Initial value only: the field is then edited locally.
	let folderInput = $state(untrack(() => app.appData.settings.kdriveSourceFolder));
	let scanning = $state(false);
	let importing = $state(false);
	let stopRequested = $state(false);
	let message = $state('');
	let folderName = $state('');
	let files = $state<SourceFile[]>([]);
	let truncated = $state(false);
	let selectedGroups = $state<Record<string, boolean>>({});
	let progress = $state({ done: 0, total: 0, errors: 0, current: '' });

	const groupLabel = (group: string) => group || '(à la racine)';

	let groups = $derived.by(() => {
		const map = new Map<string, { name: string; total: number; pending: number }>();
		for (const file of files) {
			if (!file.importable) continue;
			const entry = map.get(file.group) ?? { name: file.group, total: 0, pending: 0 };
			entry.total += 1;
			if (file.status !== 'importé') entry.pending += 1;
			map.set(file.group, entry);
		}
		return [...map.values()];
	});
	let ignored = $derived(files.filter((file) => !file.importable));
	let queue = $derived(
		files.filter(
			(file) => file.importable && file.status !== 'importé' && selectedGroups[file.group]
		)
	);

	async function scan() {
		scanning = true;
		message = 'Lecture du dossier kDrive...';
		try {
			const response = await fetch(
				`${base}/api/kdrive/source?folder=${encodeURIComponent(folderInput)}`
			);
			const payload = await response.json().catch(() => ({ message: 'Réponse illisible.' }));
			if (!response.ok) {
				message = payload.message ?? `Erreur ${response.status}`;
				files = [];
				return;
			}
			files = payload.files;
			folderName = payload.folder.name;
			truncated = payload.truncated;
			// Everything is ticked except reference material (Ressource).
			selectedGroups = Object.fromEntries(
				[...new Set(payload.files.map((file: SourceFile) => file.group))].map((group) => [
					group,
					!/^ressources?$/i.test(String(group))
				])
			);
			app.appData.settings.kdriveSourceFolder = folderInput;
			message = `${files.length} fichiers trouvés dans « ${folderName} ».`;
		} catch {
			message = 'Erreur réseau pendant la lecture du dossier.';
		} finally {
			scanning = false;
		}
	}

	async function runImport() {
		const items = [...queue];
		importing = true;
		stopRequested = false;
		progress = { done: 0, total: items.length, errors: 0, current: '' };

		for (const file of items) {
			if (stopRequested) break;
			progress.current = file.path;
			try {
				const response = await fetch(`${base}/api/kdrive/import`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ fileId: file.id, path: file.path })
				});
				const payload = (await response.json().catch(() => ({}))) as {
					data?: AppData;
					record?: { status: SourceFile['status']; message: string };
					message?: string;
				};
				if (payload.data) app.appData = payload.data;
				file.status = payload.record?.status ?? (response.ok ? 'importé' : 'erreur');
				file.message = payload.record?.message ?? payload.message ?? '';
			} catch {
				file.status = 'erreur';
				file.message = 'Erreur réseau.';
			}
			if (file.status === 'erreur') progress.errors += 1;
			progress.done += 1;
		}

		importing = false;
		progress.current = '';
		message = stopRequested
			? `Import interrompu : ${progress.done} fichiers traités.`
			: `Import terminé : ${progress.done - progress.errors} importés, ${progress.errors} erreurs.`;
	}
</script>

<div class="sync-card">
	<div class="panel-heading">
		<h3>Import depuis kDrive</h3>
	</div>
	<p class="muted">
		Colle l’adresse du dossier kDrive qui contient tes documents (bulletins, contrats, AEM,
		notifications ARE). Les originaux sont seulement lus, jamais modifiés. Relancer l’import ne
		reprend que les fichiers pas encore importés.
	</p>
	<label>
		<span>Dossier kDrive (adresse ou identifiant)</span>
		<input
			type="text"
			placeholder="https://ksuite.infomaniak.com/.../files/1234"
			bind:value={folderInput}
			disabled={importing}
		/>
	</label>
	<div class="button-row">
		<button type="button" onclick={scan} disabled={scanning || importing || !folderInput.trim()}>
			{scanning ? 'Lecture...' : 'Lire le dossier'}
		</button>
		{#if groups.length}
			{#if importing}
				<button type="button" onclick={() => (stopRequested = true)}>Arrêter</button>
			{:else}
				<button type="button" class="primary" onclick={runImport} disabled={!queue.length}>
					Importer {queue.length} fichier{queue.length > 1 ? 's' : ''}
				</button>
			{/if}
		{/if}
	</div>

	{#if message}<p class="muted">{message}</p>{/if}
	{#if truncated}
		<p class="muted">Dossier très grand : seule une partie a été lue. Choisis un sous-dossier.</p>
	{/if}

	{#if importing || progress.total}
		<div class="progress-line">
			<progress max={progress.total} value={progress.done}></progress>
			<small>{progress.done} / {progress.total}{progress.current ? ` · ${progress.current}` : ''}</small>
		</div>
	{/if}

	{#if groups.length}
		<div class="kdrive-groups">
			{#each groups as group (group.name)}
				<label class="kdrive-group">
					<input
						type="checkbox"
						bind:checked={selectedGroups[group.name]}
						disabled={importing}
					/>
					<span>{groupLabel(group.name)}</span>
					<small>{group.pending} à importer / {group.total}</small>
				</label>
				<details class="kdrive-files">
					<summary>Voir les {group.total} fichier{group.total > 1 ? 's' : ''}</summary>
					<ul>
						{#each files.filter((file) => file.importable && file.group === group.name) as file (file.id)}
							<li>
								<span>{file.path}</span>
								<small class:ko={file.status === 'erreur'}>
									{file.status || 'à importer'}
								</small>
							</li>
						{/each}
					</ul>
				</details>
			{/each}
		</div>
	{/if}

	{#if files.some((file) => file.status === 'erreur')}
		<details>
			<summary>Fichiers en erreur</summary>
			<ul class="kdrive-errors">
				{#each files.filter((file) => file.status === 'erreur') as file (file.id)}
					<li><strong>{file.path}</strong> · {file.message}</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if ignored.length}
		<details>
			<summary>{ignored.length} fichiers ignorés (formats non analysés)</summary>
			<ul class="kdrive-errors">
				{#each ignored as file (file.id)}
					<li>{file.path}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.muted {
		margin: 0;
		color: rgba(237, 241, 238, 0.68);
	}

	.progress-line {
		display: grid;
		gap: 4px;
	}

	.progress-line progress {
		width: 100%;
		accent-color: #26b19c;
	}

	.kdrive-groups {
		display: grid;
		gap: 6px;
	}

	.kdrive-group {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
	}

	.kdrive-group span {
		overflow-wrap: anywhere;
	}

	.kdrive-files {
		margin: -2px 0 4px 26px;
	}

	.kdrive-files summary {
		cursor: pointer;
		color: rgba(237, 241, 238, 0.68);
		font-size: 12px;
	}

	.kdrive-files ul {
		display: grid;
		gap: 2px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		max-height: 260px;
		overflow-y: auto;
	}

	.kdrive-files li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		font-size: 12px;
	}

	.kdrive-files li span {
		overflow-wrap: anywhere;
	}

	.kdrive-files .ko {
		color: #f39a86;
	}

	.kdrive-errors {
		margin: 6px 0 0;
		padding-left: 18px;
		overflow-wrap: anywhere;
	}
</style>
