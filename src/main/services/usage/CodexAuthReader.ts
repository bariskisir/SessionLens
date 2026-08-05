/**
 * @file CodexAuthReader.ts
 * @description Reads and persists Codex OAuth credentials in the local `.codex/auth.json` file.
 */

import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Codex OAuth material required to query usage. */
export interface CodexAuth {
  accessToken: string
  accountId?: string | null | undefined
  refreshToken?: string | null | undefined
  idToken?: string | null | undefined
  lastRefresh?: string | null | undefined
}

/**
 * Returns the default file path to the Codex CLI auth file.
 *
 * @returns File path string
 */
const defaultAuthFilePath = (): string => join(homedir(), '.codex', 'auth.json')

/**
 * Reads and parses JSON file content safely.
 *
 * @param path - Target file path
 * @returns Parsed record object or null if unreadable
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
 * Formats a refresh timestamp using the Codex CLI's `yyyy-MM-dd'T'HH:mm:ss.fffffffZ` format.
 *
 * @param value - Date object to format
 * @returns Formatted ISO string with fractional milliseconds
 */
const formatLastRefresh = (value: Date): string => {
  const iso = value.toISOString()
  const fractional = (value.getMilliseconds() * 10_000).toString().padStart(7, '0')
  return `${iso.slice(0, 19)}.${fractional}Z`
}

/**
 * Service for reading and persisting Codex CLI OAuth credentials.
 */
export default class CodexAuthReader {
  /** File path for the Codex auth JSON file. */
  private readonly authFilePath: string

  /**
   * Initializes a new instance of CodexAuthReader.
   *
   * @param authFilePath - Custom file path, defaulting to user home `.codex/auth.json`
   */
  public constructor(authFilePath = defaultAuthFilePath()) {
    this.authFilePath = authFilePath
  }

  /**
   * Returns the current Codex OAuth credentials, or null when unavailable or missing an access token.
   *
   * @returns CodexAuth object or null
   */
  public async read(): Promise<CodexAuth | null> {
    const root = await readJson(this.authFilePath)
    if (!root) return null
    const tokenSource =
      root.tokens && typeof root.tokens === 'object' && !Array.isArray(root.tokens)
        ? (root.tokens as Record<string, unknown>)
        : root
    const accessToken =
      typeof tokenSource.access_token === 'string' ? tokenSource.access_token : null
    if (!accessToken) return null
    return {
      accessToken,
      accountId: typeof tokenSource.account_id === 'string' ? tokenSource.account_id : null,
      refreshToken:
        typeof tokenSource.refresh_token === 'string' ? tokenSource.refresh_token : null,
      idToken: typeof tokenSource.id_token === 'string' ? tokenSource.id_token : null,
      lastRefresh:
        typeof root.last_refresh === 'string'
          ? (root.last_refresh as string)
          : null,
    }
  }

  /**
   * Persists refreshed OAuth material back to the Codex auth file.
   *
   * @param auth - Updated CodexAuth object to write
   */
  public async save(auth: CodexAuth): Promise<void> {
    const root = (await readJson(this.authFilePath)) ?? {}
    const tokens =
      root.tokens && typeof root.tokens === 'object' && !Array.isArray(root.tokens)
        ? (root.tokens as Record<string, unknown>)
        : {}
    tokens.access_token = auth.accessToken
    if (auth.refreshToken) tokens.refresh_token = auth.refreshToken
    if (auth.idToken) tokens.id_token = auth.idToken
    if (auth.accountId) tokens.account_id = auth.accountId
    root.tokens = tokens
    root.last_refresh = formatLastRefresh(auth.lastRefresh ? new Date(auth.lastRefresh) : new Date())

    const directory = dirname(this.authFilePath)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.authFilePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.authFilePath)
  }
}

