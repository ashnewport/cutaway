<script lang="ts">
	interface Props {
		label: string;
		hint?: string;
		checked: boolean;
		onchange: (checked: boolean) => void;
	}

	const { label, hint, checked, onchange }: Props = $props();
</script>

<button
	class="row"
	type="button"
	role="switch"
	aria-checked={checked}
	onclick={() => onchange(!checked)}
>
	<span class="text">
		{label}
		{#if hint}<small>{hint}</small>{/if}
	</span>
	<span class="track"><span class="thumb"></span></span>
</button>

<style>
	.row {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		border: 0;
		background: none;
		text-align: left;
	}

	small {
		display: block;
		color: var(--ink-soft);
		font-size: 12px;
	}

	.track {
		position: relative;
		flex: none;
		width: 34px;
		height: 18px;
		border: 1px solid var(--ink-soft);
		border-radius: var(--r);
	}

	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: calc(var(--r) * 0.6);
		background: var(--ink-soft);
		transition: transform 0.14s;
	}

	[aria-checked='true'] .track {
		border-color: var(--packet);
		background: var(--packet);
	}

	[aria-checked='true'] .thumb {
		background: var(--on-packet);
		transform: translateX(16px);
	}
</style>
