/**
 * @file BaseOAuthProvider.ts
 * @description Abstract OAuth provider base class with shared token-refresh and retry-on-auth-failure logic.
 */

import type { MetricResult, ProviderDescriptor, ProviderResult } from '@shared/types'
import type { IProvider, ProviderQueryContext } from './IProvider'
import { executeAuthFlow } from '../services/usage/ProviderAuthFlow'

/** Minimal credential reader contract — satisfied by BaseAuthReader and AntigravityAuthReader. */
export interface AuthReader<TAuth> {
  read(): Promise<TAuth | null>
  save(auth: TAuth): Promise<void>
}

/**
 * Base class for OAuth-authenticated providers (Codex, Claude, Antigravity).
 *
 * Encapsulates the full OAuth lifecycle: read credentials, conditionally refresh
 * tokens, call the usage API, and retry once on 401/403 with a fresh token.
 *
 * Subclasses define:
 * - `getAuthReader()` — returns the credential reader instance
 * - `shouldRefresh(auth, now)` — whether the token is due for refresh
 * - `refreshAuth(auth, now)` — perform the token refresh and return updated auth
 * - `fetchUsage(auth, now)` — call the usage API and build the MetricResult
 *
 * Subclasses may override `query()` entirely for providers with multi-step
 * usage pipelines (e.g. supplemental API calls after the primary response).
 */
export abstract class BaseOAuthProvider<
  TAuth extends { accessToken: string },
> implements IProvider {
  readonly id: string
  readonly providerName: string

  public constructor(public readonly descriptor: ProviderDescriptor) {
    this.id = descriptor.id
    this.providerName = descriptor.name
  }

  /** @inheritdoc */
  public async isConfigured(): Promise<boolean> {
    const auth = await this.getAuthReader().read()
    return auth?.accessToken != null
  }

  /** @inheritdoc */
  public async query(context: ProviderQueryContext): Promise<ProviderResult | null> {
    const auth = await this.getAuthReader().read()
    if (!auth) return null

    const allowRefresh =
      context.refreshTokenMap.get(this.id) ?? context.refreshTokenMap.get(this.providerName) ?? true

    const { auth: finalAuth, result } = await executeAuthFlow({
      auth,
      allowRefresh,
      readLatestAuth: () => this.getAuthReader().read(),
      shouldRefresh: (value) => this.shouldRefresh(value, context.now),
      refreshAsync: async (value) => {
        const refreshed = await this.refreshAuth(value, context.now)
        try {
          await this.getAuthReader().save(refreshed)
        } catch {
          // Persistence failed; in-memory auth is valid for this refresh cycle.
        }
        return refreshed
      },
      executeAsync: (value) => this.fetchUsage(value, context.now),
    })

    return this.buildResult(result, finalAuth, context.now)
  }

  // -----------------------------------------------------------------------
  // Subclass contract
  // -----------------------------------------------------------------------

  /** Returns the credential reader for this provider. */
  protected abstract getAuthReader(): AuthReader<TAuth>

  /** Returns true when the stored token should be refreshed before use. */
  protected abstract shouldRefresh(auth: TAuth, now: Date): boolean

  /** Performs the OAuth token refresh and returns updated credentials. */
  protected abstract refreshAuth(auth: TAuth, now: Date): Promise<TAuth>

  /**
   * Calls the usage API and returns a result that will be passed to `buildResult`.
   * The return value is forwarded to `buildResult` along with the final auth state.
   */
  protected abstract fetchUsage(auth: TAuth, now: Date): Promise<unknown>

  /**
   * Builds the final MetricResult from the raw API response.
   * Subclasses override this to parse provider-specific response shapes.
   * Receives both the raw fetch result AND the final auth for supplemental calls.
   */
  protected buildResult(raw: unknown, _auth: TAuth, _now: Date): MetricResult | null {
    if (!raw || typeof raw !== 'object') return null
    return raw as unknown as MetricResult | null
  }
}
