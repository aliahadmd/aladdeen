import { join } from 'node:path'

const DEVELOPMENT_USER_DATA_DIRECTORY = 'aladdeen-dev'
const PREVIOUS_APPLICATION_DIRECTORY = ['Fl', 'uid', 'MD'].join('')

export interface UserDataPolicy {
  userDataPath?: string
  previousUserDataPath?: string
}

export function resolveUserDataPolicy(input: {
  appDataPath: string
  isPackaged: boolean
  hasExplicitUserDataPath: boolean
}): UserDataPolicy {
  if (input.hasExplicitUserDataPath) return {}
  if (input.isPackaged) {
    return {
      previousUserDataPath: join(input.appDataPath, PREVIOUS_APPLICATION_DIRECTORY)
    }
  }
  return {
    userDataPath: join(input.appDataPath, DEVELOPMENT_USER_DATA_DIRECTORY)
  }
}
