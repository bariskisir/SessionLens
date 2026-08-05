/**
 * @file BaseApiKeyProvider.ts
 * @description Base class for API-key authenticated providers implementing the unified IProvider interface.
 */

import type { ProviderDescriptor, ProviderResult } from '@shared/types'
import type { IProvider, ProviderQueryContext } from './IProvider'

/**
 * Base class for all API-key authenticated providers.
 *
 * Concrete providers implement `query(context)` and resolve their API key
 * from `context.apiKeys` using the credential name from their descriptor.
 */
export abstract class BaseApiKeyProvider implements IProvider {
  readonly id: string
  readonly providerName: string

  /**
   * @param descriptor - Static provider descriptor from the catalog
   */
  public constructor(public readonly descriptor: ProviderDescriptor) {
    this.id = descriptor.id
    this.providerName = descriptor.name
  }

  /**
   * Resolves this provider's API key from the query context.
   * Falls back to the process environment if not found in context.
   *
   * @param context - Active refresh context
   * @returns API key string or null
   */
  protected resolveApiKey(context: ProviderQueryContext): string | null {
    const credentialName = this.descriptor.credentialName
    if (!credentialName) return null
    const resolved = context.apiKeys.get(credentialName)
    if (resolved) return resolved
    const envValue = process.env[credentialName]
    return envValue && envValue.trim() !== '' ? envValue : null
  }

  /** @inheritdoc */
  isConfigured(context: ProviderQueryContext): boolean {
    return this.resolveApiKey(context) !== null
  }

  /** @inheritdoc */
  abstract query(context: ProviderQueryContext): Promise<ProviderResult | null>
}
