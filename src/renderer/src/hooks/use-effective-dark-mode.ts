import { useEffect, useState } from 'react'
import { useAppStore } from '@renderer/store/app-store'

export function useEffectiveDarkMode(): boolean {
  const theme = useAppStore((state) => state.settings.theme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return theme === 'dark' || (theme === 'system' && systemDark)
}
