export async function copyPreviewText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const previousFocus = document.activeElement as HTMLElement | null
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    // Keep the fallback in the active focus scope (including an expanded dialog).
    const parent = document.querySelector('[data-preview-expanded]') ?? document.body
    parent.append(textarea)
    textarea.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { /* Clipboard unavailable. */ }
    textarea.remove()
    previousFocus?.focus({ preventScroll: true })
    return copied
  }
}
