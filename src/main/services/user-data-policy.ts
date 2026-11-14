import { join } from 'node:path'

const DEVELOPMENT_USER_DATA_DIRECTORY = 'liresearch-dev'
// Profile directories of the app's previous product names, ordered newest to
// oldest; their databases are migrated on first launch (see restorePreviousDatabase).
const PREVIOUS_APPLICATION_DIRECTORIES = ['Aladdeen', ['Fl', 'uid', 'MD'].join('')]

export interface UserDataPolicy {
  userDataPath?: string
  previousUserDataPaths?: string[]
}

export function resolveUserDataPolicy(input: {
  appDataPath: string
  isPackaged: boolean
  hasExplicitUserDataPath: boolean
}): UserDataPolicy {
  if (input.hasExplicitUserDataPath) return {}
  if (input.isPackaged) {
    return {
      previousUserDataPaths: PREVIOUS_APPLICATION_DIRECTORIES.map((directory) =>
        join(input.appDataPath, directory)
      )
    }
  }
  return {
    userDataPath: join(input.appDataPath, DEVELOPMENT_USER_DATA_DIRECTORY)
  }
}
