/**
 * @file CodexAuthReader.ts
 * @description Reads and persists Codex OAuth credentials from the local `.codex/auth.json` file.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { BaseAuthReader } from '../../providers/BaseAuthReader'

/** Codex OAuth material required to query usage. */
export interface CodexAuth {
  accessToken: string
  accountId?: string | null | undefined
  refreshToken?: string | null | undefined
  idToken?: string | null | undefined
  lastRefresh?: string | null | undefined
}

const defaultAuthFilePath = (): string => join(homedir(), '.codex', 'auth.json')

/**
 * Formats a refresh timestamp using the Codex CLI's `yyyy-MM-dd'T'HH:mm:ss.fffffffZ` format.
 */
const formatLastRefresh = (value: Date): string => {
  const iso = value.toISOString()
  const fractional = (value.getMilliseconds() * 10_000).toString().padStart(7, '0')
  return `${iso.slice(0, 19)}.${fractional}Z`
}

/**
 * Service for reading and persisting Codex CLI OAuth credentials.
 */
export default class CodexAuthReader extends BaseAuthReader<CodexAuth> {
  public constructor(authFilePath = defaultAuthFilePath()) {
    super(authFilePath)
  }

  protected extractAuth(root: Record<string, unknown>): CodexAuth | null {
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
      lastRefresh: typeof root.last_refresh === 'string' ? (root.last_refresh as string) : null,
    }
  }

  protected mergeAuth(root: Record<string, unknown>, auth: CodexAuth): Record<string, unknown> {
    const tokens =
      root.tokens && typeof root.tokens === 'object' && !Array.isArray(root.tokens)
        ? (root.tokens as Record<string, unknown>)
        : {}
    tokens.access_token = auth.accessToken
    if (auth.refreshToken) tokens.refresh_token = auth.refreshToken
    if (auth.idToken) tokens.id_token = auth.idToken
    if (auth.accountId) tokens.account_id = auth.accountId
    root.tokens = tokens
    root.last_refresh = formatLastRefresh(
      auth.lastRefresh ? new Date(auth.lastRefresh) : new Date(),
    )
    return root
  }
}
