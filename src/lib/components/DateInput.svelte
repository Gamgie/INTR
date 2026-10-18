<script lang="ts">
	import { formatIsoDateFr, parseFrenchDate } from '$lib/date';

	let {
		value = $bindable(''),
		onchange
	}: { value: string; onchange?: (value: string) => void } = $props();

	let focused = $state(false);
	let invalid = $state(false);
	let display = $state(formatIsoDateFr(value));

	$effect(() => {
		if (!focused) display = formatIsoDateFr(value);
	});

	function commit() {
		focused = false;
		const raw = display.trim();

		if (!raw) {
			value = '';
			display = '';
			invalid = false;
			onchange?.('');
			return;
		}

		const parsed = parseFrenchDate(raw);
		if (!parsed) {
			invalid = true;
			return;
		}

		value = parsed;
		display = formatIsoDateFr(parsed);
		invalid = false;
		onchange?.(parsed);
	}
</script>

<input
	type="text"
	bind:value={display}
	placeholder="jj/mm/aaaa"
	inputmode="numeric"
	autocomplete="off"
	aria-invalid={invalid}
	class:invalid
	onfocus={() => {
		focused = true;
		invalid = false;
	}}
	onblur={commit}
	onchange={commit}
/>
