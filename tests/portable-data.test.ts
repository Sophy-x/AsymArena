import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getPortableDataPath, migratePortableStore } from '../src/main/portable-data'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('portable data location', () => {
  it('uses a sibling data directory only when the portable launcher sets its directory', () => {
    expect(getPortableDataPath()).toBeUndefined()
    expect(basename(getPortableDataPath(join('Apps', 'AsymArena'))!)).toBe('AsymArenaData')
  })

  it('copies an existing roaming store once and never overwrites portable data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asymarena-portable-'))
    tempDirectories.push(root)
    const roaming = join(root, 'roaming')
    const portable = join(root, 'portable', 'AsymArenaData')
    await mkdir(roaming, { recursive: true })
    await writeFile(join(roaming, 'arena.json'), '{"matches":[]}')

    expect(await migratePortableStore(roaming, portable)).toBe(true)
    expect(await readFile(join(portable, 'arena.json'), 'utf8')).toBe('{"matches":[]}')
    await writeFile(join(portable, 'arena.json'), '{"matches":["portable"]}')
    expect(await migratePortableStore(roaming, portable)).toBe(false)
    expect(await readFile(join(portable, 'arena.json'), 'utf8')).toBe('{"matches":["portable"]}')
  })
})
