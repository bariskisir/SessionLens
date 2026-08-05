/**
 * Stores validated settings through serialized direct JSON file access.
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, AppSettingsPatch } from '@shared/types'
import { normalizeSettings, parsePersistedSettings } from '../settingsSchema'

export default class StorageService {
  private readonly settingsPath: string
  private readonly fileOperationTails = new Map<string, Promise<void>>()

  /** Creates a storage service rooted in the private application data directory. */
  public constructor(private readonly rootPath: string) {
    this.settingsPath = join(rootPath, 'settings.json')
  }

  /** Creates required directories and removes obsolete temporary files. */
  public async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    await this.removeObsoleteTemporaryFiles(this.rootPath)
  }

  /** Loads validated settings or safe defaults for missing or malformed data. */
  public async loadSettings(): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, () => this.readSettingsUnlocked())
  }

  /** Reads settings while its caller owns the settings-file operation lock. */
  private async readSettingsUnlocked(): Promise<AppSettings> {
    try {
      const value: unknown = JSON.parse(await readFile(this.settingsPath, 'utf8'))
      return parsePersistedSettings(value)
    } catch {
      return parsePersistedSettings(null)
    }
  }

  /** Validates and writes application settings directly to their JSON file. */
  public async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const validated = normalizeSettings(settings)
    await this.writeJsonFile(this.settingsPath, validated)
    return validated
  }

  /** Atomically merges changed fields into the latest validated settings document. */
  public async updateSettings(patch: AppSettingsPatch): Promise<AppSettings> {
    return this.withFileLock(this.settingsPath, async () => {
      const current = await this.readSettingsUnlocked()
      const validated = normalizeSettings({ ...current, ...patch })
      await this.writeJsonFileUnlocked(this.settingsPath, validated)
      return validated
    })
  }

  /** Serializes and writes one JSON value directly to its destination file. */
  private async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await this.withFileLock(filePath, () => this.writeJsonFileUnlocked(filePath, value))
  }

  /** Writes one complete JSON payload while its caller owns the file-operation lock. */
  private async writeJsonFileUnlocked(filePath: string, value: unknown): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }

  /** Runs one operation after every earlier operation targeting the same file. */
  private async withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.fileOperationTails.get(filePath) ?? Promise.resolve()
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.fileOperationTails.set(filePath, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.fileOperationTails.get(filePath) === tail) this.fileOperationTails.delete(filePath)
    }
  }

  /** Removes only obsolete temporary files created by older direct-write builds. */
  private async removeObsoleteTemporaryFiles(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    await Promise.allSettled(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
        .map((entry) => unlink(join(directoryPath, entry.name))),
    )
  }
}
