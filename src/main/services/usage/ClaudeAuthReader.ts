/**
 * @file ClaudeAuthReader.ts
 * @description Reads and persists Claude OAuth credentials from the local `.claude/.credentials.json` file.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { BaseAuthReader } from '../../providers/BaseAuthReader'

/** Claude OAuth material required to query usage. */
export interface ClaudeAuth {
  accessToken: string
  subscriptionType?: string | null | undefined
  rateLimitTier?: string | null | undefined
  refreshToken?: string | null | undefined
  expiresAt?: string | null | undefined
  scopes?: string[] | undefined
}

const defaultAuthFilePath = (): string => join(homedir(), '.claude', '.credentials.json')

/**
 * Parses and sanitises OAuth scope strings array.
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
export default class ClaudeAuthReader extends BaseAuthReader<ClaudeAuth> {
  public constructor(authFilePath = defaultAuthFilePath()) {
    super(authFilePath)
  }

  protected extractAuth(root: Record<string, unknown>): ClaudeAuth | null {
    const oauth =
      root.claudeAiOauth &&
      typeof root.claudeAiOauth === 'object' &&
      !Array.isArray(root.claudeAiOauth)
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
      expiresAt:
        typeof oauth.expiresAt === 'number' ? new Date(oauth.expiresAt).toISOString() : null,
      scopes: readScopes(oauth.scopes),
    }
  }

  protected mergeAuth(root: Record<string, unknown>, auth: ClaudeAuth): Record<string, unknown> {
    const oauth =
      root.claudeAiOauth &&
      typeof root.claudeAiOauth === 'object' &&
      !Array.isArray(root.claudeAiOauth)
        ? (root.claudeAiOauth as Record<string, unknown>)
        : {}
    oauth.accessToken = auth.accessToken
    if (auth.refreshToken) oauth.refreshToken = auth.refreshToken
    if (auth.expiresAt) oauth.expiresAt = new Date(auth.expiresAt).getTime()
    if (auth.subscriptionType) oauth.subscriptionType = auth.subscriptionType
    if (auth.rateLimitTier) oauth.rateLimitTier = auth.rateLimitTier
    if (auth.scopes && auth.scopes.length > 0) oauth.scopes = auth.scopes
    root.claudeAiOauth = oauth
    return root
  }
}
