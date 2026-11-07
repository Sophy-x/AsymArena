import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function getPortableDataPath(portableDirectory?: string): string | undefined {
  if (!portableDirectory) return undefined
  return join(portableDirectory, 'AsymArenaData')
}

export async function migratePortableStore(sourceDirectory: string, targetDirectory: string): Promise<boolean> {
  const source = join(sourceDirectory, 'arena.json')
  const target = join(targetDirectory, 'arena.json')
  try {
    await stat(target)
    return false
  } catch {
    // First portable launch: keep the existing roaming store by copying it once.
  }
  try {
    await stat(source)
  } catch {
    return false
  }
  await mkdir(dirname(target), { recursive: true })
  await copyFile(source, target)
  return true
}
