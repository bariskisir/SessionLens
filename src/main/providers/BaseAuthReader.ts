/**
 * @file BaseAuthReader.ts
 * @description Shared JSON file persistence for OAuth credential readers, providing
 * atomic read-modify-write operations with tmp-file + rename safety.
 */

import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Reads and parses a JSON file, returning null when the file is missing or unparseable.
 *
 * @param path - Absolute file path
 * @returns Parsed record object or null
 */
const readJson = async (path: string): Promise<Record<string, unknown> | null> => {
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Atomically writes a JSON value to disk using a temporary file and rename.
 *
 * @param path - Target file path
 * @param value - Serializable value
 */
const writeJsonAtomic = async (path: string, value: unknown): Promise<void> => {
  const directory = dirname(path)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}

/**
 * Generic JSON file auth reader.
 *
 * Subclasses define how to extract auth material from the parsed JSON document
 * and how to merge refreshed auth back into it. The base class handles all
 * file I/O and the atomic write pattern.
 */
export abstract class BaseAuthReader<TAuth> {
  /**
   * @param authFilePath - Absolute path to the credentials JSON file
   */
  public constructor(protected readonly authFilePath: string) {}

  /**
   * Reads the current OAuth credentials from disk, returning null when
   * the file is missing, unparseable, or does not contain a usable token.
   *
   * @returns Auth object or null
   */
  public async read(): Promise<TAuth | null> {
    const root = await readJson(this.authFilePath)
    if (!root) return null
    return this.extractAuth(root)
  }

  /**
   * Persists refreshed OAuth material back to the credentials file.
   * Reads the current document, merges updated fields via `mergeAuth`,
   * and writes back atomically.
   *
   * @param auth - Updated auth object to persist
   */
  public async save(auth: TAuth): Promise<void> {
    const root = (await readJson(this.authFilePath)) ?? {}
    const updated = this.mergeAuth(root, auth)
    await writeJsonAtomic(this.authFilePath, updated)
  }

  /**
   * Extracts typed auth material from the parsed JSON document.
   * Return null if the document lacks a usable access token.
   *
   * @param root - Parsed JSON root object
   * @returns Extracted auth or null
   */
  protected abstract extractAuth(root: Record<string, unknown>): TAuth | null

  /**
   * Merges refreshed auth fields back into the root document, returning
   * the complete document to persist.
   *
   * @param root - Current parsed JSON root (may be empty)
   * @param auth - Refreshed auth object
   * @returns Complete document ready for serialisation
   */
  protected abstract mergeAuth(root: Record<string, unknown>, auth: TAuth): Record<string, unknown>
}
