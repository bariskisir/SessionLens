/**
 * @file CredentialProbe.ts
 * @description Detects which providers already have usable credentials on this machine so first launch can enable them automatically.
 */

import { PROVIDER_DESCRIPTORS } from '@shared/config/providers'
import AntigravityAuthReader from '../services/usage/AntigravityAuthReader'
import ClaudeAuthReader from '../services/usage/ClaudeAuthReader'
import CodexAuthReader from '../services/usage/CodexAuthReader'

/**
 * Detects provider credentials available on this machine: OAuth material for Codex, Claude,
 * and Antigravity, plus the credential environment variables for API-key providers.
 *
 * @returns Provider descriptor IDs that appear configured
 */
export const probeConfiguredProviderIds = async (): Promise<string[]> => {
  const configured = new Set<string>()

  const codexAuth = await new CodexAuthReader().read()
  if (codexAuth) configured.add('codex')
  const claudeAuth = await new ClaudeAuthReader().read()
  if (claudeAuth) configured.add('claude')
  const antigravityAuth = await new AntigravityAuthReader().read()
  if (antigravityAuth) configured.add('antigravity')

  for (const descriptor of PROVIDER_DESCRIPTORS) {
    if (descriptor.authenticationKind !== 'apiKey' || !descriptor.credentialName) continue
    const envValue = process.env[descriptor.credentialName]
    if (typeof envValue === 'string' && envValue.trim() !== '') configured.add(descriptor.id)
  }

  return [...configured]
}
