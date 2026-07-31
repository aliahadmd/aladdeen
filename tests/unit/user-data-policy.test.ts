// @vitest-environment node
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUserDataPolicy } from '@main/services/user-data-policy'

describe('application user-data policy', () => {
  const appDataPath = join('/Users', 'researcher', 'Library', 'Application Support')

  it('isolates development and preview runs from installed application data', () => {
    expect(resolveUserDataPolicy({
      appDataPath,
      isPackaged: false,
      hasExplicitUserDataPath: false
    })).toEqual({
      userDataPath: join(appDataPath, 'aladdeen-dev')
    })
  })

  it('preserves an explicit user-data directory for tests and diagnostics', () => {
    expect(resolveUserDataPolicy({
      appDataPath,
      isPackaged: false,
      hasExplicitUserDataPath: true
    })).toEqual({})
    expect(resolveUserDataPolicy({
      appDataPath,
      isPackaged: true,
      hasExplicitUserDataPath: true
    })).toEqual({})
  })

  it('keeps legacy migration available only to a normal packaged launch', () => {
    expect(resolveUserDataPolicy({
      appDataPath,
      isPackaged: true,
      hasExplicitUserDataPath: false
    })).toEqual({
      previousUserDataPath: join(appDataPath, 'FluidMD')
    })
  })
})
