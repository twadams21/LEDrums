<script lang="ts">
  /* Shared line-icon set. 16px grid, inherits currentColor + stroke. */
  interface Props {
    name: string;
    size?: number;
  }
  let { name, size = 16 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'perform'}
    <path d="M5 3.5l7 4.5-7 4.5z" fill="currentColor" stroke="none" />
  {:else if name === 'arrange'}
    <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />
  {:else if name === 'settings'}
    <path d="M2.5 5h7M12 5h1.5M2.5 11h1.5M6.5 11h7" />
    <circle cx="10.5" cy="5" r="1.6" fill="var(--surface)" />
    <circle cx="4.5" cy="11" r="1.6" fill="var(--surface)" />
  {:else if name === 'patch'}
    <circle cx="3.5" cy="4" r="1.6" /><circle cx="12.5" cy="12" r="1.6" />
    <path d="M5 4.5h3.5a2 2 0 0 1 2 2v3" />
  {:else if name === 'output'}
    <path d="M4 11a5 5 0 0 1 8 0" /><path d="M6 11a2.6 2.6 0 0 1 4 0" />
    <circle cx="8" cy="12" r="0.8" fill="currentColor" />
  {:else if name === 'kit'}
    <ellipse cx="8" cy="5.5" rx="5" ry="2.2" /><path d="M3 5.5v4c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2v-4" />
  {:else if name === 'input'}
    <path d="M2 8h8" /><path d="M7 5l3 3-3 3" /><path d="M13 3v10" />
  {:else if name === 'content'}
    <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.2" fill="currentColor" />
  {:else if name === 'effect'}
    <path d="M8 2.5l1.4 3.1L12.5 7 9.4 8.4 8 11.5 6.6 8.4 3.5 7l3.1-1.4z" />
  {:else if name === 'layer'}
    <path d="M8 2.5l5 2.6-5 2.6-5-2.6z" /><path d="M3 8.5l5 2.6 5-2.6" />
  {:else if name === 'mod'}
    <path d="M2 8c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 3 0" />
  {:else if name === 'chevron-right'}
    <path d="M6 3.5L10.5 8 6 12.5" />
  {:else if name === 'chevron-down'}
    <path d="M3.5 6L8 10.5 12.5 6" />
  {:else if name === 'collapse'}
    <path d="M9.5 3.5L5 8l4.5 4.5" /><path d="M12.5 3.5L8 8l4.5 4.5" />
  {:else if name === 'expand'}
    <path d="M6.5 3.5L11 8l-4.5 4.5" /><path d="M3.5 3.5L8 8l-4.5 4.5" />
  {/if}
</svg>
