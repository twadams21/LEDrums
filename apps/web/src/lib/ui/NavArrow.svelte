<script lang="ts">
  import IconButton from './IconButton.svelte';
  import { navArrowLabel, navArrowTip, type NavArrowDirection } from './nav-arrow-tip';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  type Props = {
    direction: NavArrowDirection;
    unit: string;
    disabled?: boolean;
    binding?: string | null;
    bindingInvite?: string;
    size?: number;
    onclick?: () => void;
  };

  let { direction, unit, disabled = false, binding = null, bindingInvite, size = 14, onclick }: Props = $props();
  const label = $derived(navArrowLabel(direction, unit));
  const tip = $derived(navArrowTip(direction, unit, disabled, binding, bindingInvite));
</script>

<IconButton
  icon={direction === 'prev' ? ChevronLeft : ChevronRight}
  {label}
  {size}
  {disabled}
  {onclick}
  tooltipText={tip}
  disabledReason={disabled ? tip : undefined}
/>
