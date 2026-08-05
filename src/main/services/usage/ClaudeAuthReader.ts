/**
 * @file ClaudeAuthReader.ts
 * @description Reads and persists Claude OAuth credentials in the local `.claude/.credentials.json` file.
 */

import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Claude OAuth material required to query usage. */
export interface ClaudeAuth {
  accessToken: string
  subscriptionType?: string | null | undefined
  rateLimitTier?: string | null | undefined
  refreshToken?: string | null | undefined
  expiresAt?: string | null | undefined
  scopes?: string[] | undefined
}

/**
 * Returns the default file path to Claude CLI credentials file.
 *
 * @returns File path string
 */
const defaultAuthFilePath = (): string => join(homedir(), '.claude', '.credentials.json')

/**
 * Reads and parses JSON file content safely.
 *
 * @param path - File path to read
 * @returns Parsed record object or null if invalid or unreadable
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
 * Parses and sanitizes OAuth scope strings array.
 *
 * @param value - Scope property value
 * @returns Array of scope strings or undefined
 */
const readScopes = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const scopes = value
    .filter((scope): scope is string => typeof scope === 'string' && scope.trim() !== '')
    .map((scope) => scope.trim())
  return scopes.length > 0 ? scopes : undefined
}

/**
 * Service for reading and persisting Claude CLI OAuth credentials.
 */
export default class ClaudeAuthReader {
  /** Target file path for Claude credentials JSON file. */
  private readonly authFilePath: string

  /**
   * Initializes a new instance of ClaudeAuthReader.
   *
   * @param authFilePath - Custom credentials file path, defaulting to user home `.claude/.credentials.json`
   */
  public constructor(authFilePath = defaultAuthFilePath()) {
    this.authFilePath = authFilePath
  }

  /**
   * Returns the current Claude OAuth credentials, or null when unavailable or missing an access token.
   *
   * @returns ClaudeAuth object or null
   */
  public async read(): Promise<ClaudeAuth | null> {
    const root = await readJson(this.authFilePath)
    if (!root) return null
    const oauth =
      root.claudeAiOauth && typeof root.claudeAiOauth === 'object' && !Array.isArray(root.claudeAiOauth)
        ? (root.claudeAiOauth as Record<string, unknown>)
        : null
    if (!oauth) return null
    const accessToken = typeof oauth.accessToken === 'string' ? oauth.accessToken : null
    if (!accessToken) return null
    return {
      accessToken,
      subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null,
      rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
      refreshToken: typeof oauth.refreshToken === 'string' ? oauth.refreshToken : null,
      expiresAt: typeof oauth.expiresAt === 'number' ? new Date(oauth.expiresAt).toISOString() : null,
      scopes: readScopes(oauth.scopes),
    }
  }

  /**
   * Persists refreshed OAuth material back to the local Claude credentials file.
   *
   * @param auth - Updated ClaudeAuth object to write
   */
  public async save(auth: ClaudeAuth): Promise<void> {
    const root = (await readJson(this.authFilePath)) ?? {}
    const oauth =
      root.claudeAiOauth && typeof root.claudeAiOauth === 'object' && !Array.isArray(root.claudeAiOauth)
        ? (root.claudeAiOauth as Record<string, unknown>)
        : {}
    oauth.accessToken = auth.accessToken
    if (auth.refreshToken) oauth.refreshToken = auth.refreshToken
    if (auth.expiresAt) oauth.expiresAt = new Date(auth.expiresAt).getTime()
    if (auth.subscriptionType) oauth.subscriptionType = auth.subscriptionType
    if (auth.rateLimitTier) oauth.rateLimitTier = auth.rateLimitTier
    if (auth.scopes && auth.scopes.length > 0) oauth.scopes = auth.scopes
    root.claudeAiOauth = oauth

    const directory = dirname(this.authFilePath)
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
    const temporaryPath = `${this.authFilePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, this.authFilePath)
  }
}

