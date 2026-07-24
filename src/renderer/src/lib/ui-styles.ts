import { cn } from './cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'default' | 'large'

interface ButtonClassOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast shadow-[0_4px_12px_color-mix(in_oklab,var(--accent)_25%,transparent)] disabled:opacity-[.45]',
  secondary: 'border-border-strong bg-surface-elevated',
  ghost: 'bg-transparent text-foreground-soft',
  danger: 'bg-danger text-white'
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'h-[34px] px-[13px]',
  large: 'h-[38px] px-[15px]'
}

export const eyebrowClasses =
  'mb-3 text-[10px] font-[750] tracking-[.16em] text-accent'

export const privacyNoteClasses =
  'inline-flex items-center gap-[6px] text-[10px] text-foreground-muted'

export const dialogInputClasses =
  'mt-4 h-[34px] w-full select-text rounded-[7px] border border-border-strong bg-surface px-[10px] text-foreground focus:border-accent focus:shadow-[0_0_0_2px_var(--accent-soft)] focus-visible:!outline-none'

export const centeredEmptyClasses =
  'flex min-h-[100px] items-center justify-center gap-[7px] text-[10px] text-foreground-muted'

export const dropdownContentClasses =
  'dropdown-content z-[180] min-w-[182px] rounded-[9px] border border-border bg-[color-mix(in_oklab,var(--surface-elevated)_97%,transparent)] p-[5px] opacity-100 shadow-[0_12px_35px_rgb(0_0_0/.14),0_2px_8px_rgb(0_0_0/.07)] [transform-origin:var(--radix-dropdown-menu-content-transform-origin)] [transition:transform_160ms_var(--ease-out),opacity_140ms_ease] data-[state=closed]:scale-[.97] data-[state=closed]:opacity-0'

export const dropdownLabelClasses =
  'dropdown-label px-[7px] pt-[6px] pb-1 text-[9px] font-bold tracking-[.06em] text-foreground-muted uppercase'

export const dropdownSeparatorClasses =
  'dropdown-separator m-1 h-px bg-border'

export const itemHintClasses =
  'item-hint text-[9px] text-foreground-muted'

export const menuCheckClasses =
  'menu-check grid w-[18px] place-items-center'

export function dropdownItemClasses(destructive = false): string {
  return cn(
    'dropdown-item grid min-h-[30px] cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[7px] rounded-[6px] px-[7px] text-[11px] text-foreground-soft outline-0 data-[disabled]:opacity-[.45] data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent',
    destructive && 'destructive-item text-danger data-[highlighted]:text-danger'
  )
}

export const tooltipContentClasses =
  'tooltip-content z-[190] rounded-[5px] bg-[#25252b] px-[7px] py-[5px] text-[10px] text-[#f6f6f8] opacity-100 shadow-[0_5px_16px_rgb(0_0_0/.2)] [transform-origin:var(--radix-tooltip-content-transform-origin)] [transition:transform_125ms_var(--ease-out),opacity_125ms_ease] data-[state=closed]:scale-[.97] data-[state=closed]:opacity-0'

export const tooltipArrowClasses = 'tooltip-arrow fill-[#25252b]'

export const tabBarClasses =
  'tabbar flex h-[37px] min-w-0 overflow-x-auto overflow-y-hidden border-b border-border bg-surface [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

export const tabNameClasses =
  'tab-name overflow-hidden text-left text-ellipsis whitespace-nowrap'

export function documentTabClasses(active: boolean): string {
  return cn(
    'document-tab group inline-grid h-[37px] min-w-[104px] max-w-[220px] flex-[0_1_190px] cursor-default grid-cols-[15px_minmax(52px,1fr)_10px_18px] items-center gap-[6px] rounded-none border-0 border-r border-border bg-transparent py-0 pr-[7px] pl-[10px] text-[11px] text-foreground-muted hover:bg-surface-hover hover:text-foreground',
    active &&
      "relative bg-surface-elevated text-foreground after:absolute after:right-0 after:-bottom-px after:left-0 after:h-0.5 after:bg-accent after:content-['']"
  )
}

export function tabStateClasses(status: string): string {
  return cn(
    'tab-state text-[18px] leading-none text-foreground-muted',
    (status === 'conflict' || status === 'error') && 'text-danger'
  )
}

export function tabCloseClasses(active: boolean): string {
  return cn(
    'tab-close grid h-[18px] w-[18px] place-items-center rounded opacity-[.15] text-foreground-soft group-hover:opacity-75 group-focus-within:opacity-75 hover:bg-border-strong',
    active && 'opacity-75'
  )
}

export const documentActionsClasses =
  'document-actions absolute top-[10px] right-3 z-30 flex items-center gap-[3px] rounded-[10px] border border-[color-mix(in_oklab,var(--border)_90%,transparent)] bg-[color-mix(in_oklab,var(--surface-elevated)_90%,transparent)] p-[3px] shadow-[0_6px_22px_rgb(0_0_0/.1),inset_0_1px_0_rgb(255_255_255/.05)] backdrop-blur-[14px] [.document-workspace:has(.compact-pane-switch)_&]:max-[959px]:top-[45px]'

export function documentActionButtonClasses(active = false): string {
  return cn(
    'document-action-button inline-flex h-[29px] items-center justify-center gap-[6px] rounded-[7px] border-0 bg-transparent px-2 text-[11px] font-semibold text-foreground-soft transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground max-[700px]:w-[31px] max-[700px]:px-0 max-[700px]:[&_span]:hidden max-[700px]:[&_.action-chevron]:hidden',
    active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
  )
}

export const sidebarClasses =
  'sidebar environment-sidebar flex h-full min-h-0 w-(--sidebar-width) flex-col border-r border-border bg-[color-mix(in_oklab,var(--surface)_98%,var(--bg))]'

export const sidebarIconButtonClasses =
  'sidebar-icon-button grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent p-0 text-foreground-muted transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground'

export const sectionAddClasses =
  'section-add grid h-[23px] w-[23px] place-items-center rounded-md border-0 bg-transparent p-0 text-foreground-muted transition-transform duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground'

export const rowMoreClasses =
  'row-more grid h-[23px] w-[23px] shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-foreground-muted opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-surface-hover hover:text-foreground data-[state=open]:opacity-100'

export const sidebarQuickActionClasses =
  'flex h-[29px] items-center gap-2 rounded-[7px] border-0 bg-transparent px-2 text-left text-[12px] text-foreground-soft transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground'

export const sidebarFooterButtonClasses =
  'sidebar-footer-button inline-flex h-[31px] min-w-0 items-center gap-[7px] rounded-[7px] border-0 bg-transparent px-2 text-[11px] text-foreground-soft transition-[transform,background-color,color] duration-[140ms] ease-fluid-out active:scale-[.97] hover:bg-surface-hover hover:text-foreground [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap'

export function projectRowClasses(selected: boolean): string {
  return cn(
    'project-row group/row flex h-[29px] min-w-0 items-center rounded-[7px] text-foreground-soft hover:bg-surface-hover hover:text-foreground',
    selected && 'bg-surface-hover text-foreground'
  )
}

export function environmentTreeRowClasses(active: boolean): string {
  return cn(
    'environment-tree-row group/row flex h-[29px] min-w-0 items-center rounded-[7px] pl-[calc(15px+var(--tree-depth)*14px)] text-[11px] text-foreground-soft hover:bg-surface-hover hover:text-foreground',
    active && 'bg-surface-hover text-foreground'
  )
}

export function trackedFileRowClasses(active: boolean, missing: boolean): string {
  return cn(
    'tracked-file-row group/row mr-[5px] flex min-h-[45px] min-w-0 items-center rounded-[7px] pr-[3px] text-foreground-soft hover:bg-surface-hover hover:text-foreground',
    active && 'bg-surface-hover text-foreground',
    missing && 'opacity-[.72]'
  )
}

export function treeLoadMoreClasses(nested = false): string {
  return cn(
    'tree-load-more min-h-[25px] w-full border-0 bg-transparent pl-[calc(35px+var(--tree-depth,0)*14px)] text-left text-[9px] text-foreground-muted hover:bg-surface-hover hover:text-foreground',
    nested && 'pl-12'
  )
}

export const dialogOverlayClasses =
  'dialog-overlay fixed inset-0 z-[200] bg-[rgb(10_10_15/.4)] opacity-100 backdrop-blur-[3px] transition-opacity duration-[170ms] ease-[ease] data-[state=closed]:opacity-0'

export const dialogContentClasses =
  'dialog-content fixed top-1/2 left-1/2 z-[201] w-[min(calc(100vw-32px),410px)] -translate-x-1/2 -translate-y-1/2 scale-100 rounded-[13px] border border-border bg-surface-elevated p-[22px] opacity-100 shadow-[0_24px_70px_rgb(0_0_0/.24),0_4px_15px_rgb(0_0_0/.08)] [transition:transform_190ms_var(--ease-out),opacity_160ms_ease] data-[state=closed]:scale-[.96] data-[state=closed]:opacity-0'

export const dialogTitleClasses =
  'dialog-title m-0 text-[16px] font-[680] tracking-[-.01em] text-foreground'

export const dialogDescriptionClasses =
  'dialog-description mt-[7px] mb-0 text-[12px] leading-[1.55] text-foreground-soft'

export const dialogActionsClasses =
  'dialog-actions mt-5 flex justify-end gap-[7px]'

export const dialogCloseClasses =
  'dialog-close grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-foreground-muted hover:bg-surface-hover hover:text-foreground'

type DialogIconVariant = 'default' | 'destructive' | 'warning'

export function dialogIconClasses(variant: DialogIconVariant = 'default'): string {
  return cn(
    'dialog-icon mb-[15px] grid h-9 w-9 place-items-center rounded-[10px] bg-accent-soft text-accent',
    variant === 'destructive' && 'bg-danger-soft text-danger',
    variant === 'warning' &&
      'bg-[color-mix(in_oklab,var(--warning)_15%,var(--surface-elevated))] text-warning'
  )
}

export function buttonClasses({
  variant = 'primary',
  size = 'default',
  className
}: ButtonClassOptions = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-[7px] rounded-[8px] border border-transparent text-[12px] font-semibold transition-[transform,background-color,border-color] duration-[140ms] ease-fluid-out active:scale-[.97]',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className
  )
}
