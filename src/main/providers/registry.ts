/**
 * @file registry.ts
 * @description Central provider registry — the single place where all provider instances are created and exported.
 *
 * Adding a new provider requires only:
 * 1. Create the provider class file in this directory
 * 2. Add one entry to PROVIDER_DESCRIPTORS in `src/shared/config/providers.ts`
 * 3. Add one line here
 */

import { providerDescriptorMap } from '@shared/config/providers'
import type { IProvider } from './IProvider'

// OAuth providers (refactored to extend BaseOAuthProvider)
import CodexProvider from '../services/usage/providers/CodexProvider'
import ClaudeProvider from '../services/usage/providers/ClaudeProvider'
import AntigravityProvider from '../services/usage/providers/AntigravityProvider'
import CodexAuthReader from '../services/usage/CodexAuthReader'
import ClaudeAuthReader from '../services/usage/ClaudeAuthReader'
import AntigravityAuthReader from '../services/usage/AntigravityAuthReader'

// API key providers (all extend the unified BaseApiKeyProvider)
import DeepSeekProvider from '../services/usage/providers/DeepSeekProvider'
import OpenRouterProvider from '../services/usage/providers/OpenRouterProvider'
import CommandCodeProvider from '../services/usage/providers/CommandCodeProvider'
import CopilotProvider from '../services/usage/providers/CopilotProvider'
import WarpProvider from '../services/usage/providers/WarpProvider'
import SyntheticProvider from '../services/usage/providers/SyntheticProvider'
import ChutesProvider from '../services/usage/providers/ChutesProvider'
import ZaiProvider from '../services/usage/providers/ZaiProvider'
import ElevenLabsProvider from '../services/usage/providers/ElevenLabsProvider'
import AlibabaProvider from '../services/usage/providers/AlibabaProvider'
import MiniMaxProvider from '../services/usage/providers/MiniMaxProvider'
import KiloProvider from '../services/usage/providers/KiloProvider'
import CodebuffProvider from '../services/usage/providers/CodebuffProvider'
import OpenAIProvider from '../services/usage/providers/OpenAIProvider'
import VeniceProvider from '../services/usage/providers/VeniceProvider'
import ZenMuxProvider from '../services/usage/providers/ZenMuxProvider'
import CrofProvider from '../services/usage/providers/CrofProvider'
import MoonshotProvider from '../services/usage/providers/MoonshotProvider'
import PoeProvider from '../services/usage/providers/PoeProvider'
import DeepgramProvider from '../services/usage/providers/DeepgramProvider'

import type { ProviderDescriptor } from '@shared/types'

/**
 * Resolves the catalog descriptor for a provider ID, throwing when missing so
 * registry construction fails loudly on catalog drift.
 *
 * @param id - Provider ID matching PROVIDER_DESCRIPTORS
 * @returns Matching ProviderDescriptor
 */
const descriptor = (id: string): ProviderDescriptor => {
  const found = providerDescriptorMap.get(id)
  if (!found) throw new Error(`Missing provider descriptor for "${id}".`)
  return found
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Every registered provider, in settings display order. */
export const ALL_PROVIDERS: IProvider[] = [
  // OAuth providers (already implementing IProvider via BaseOAuthProvider)
  new CodexProvider(new CodexAuthReader()),
  new ClaudeProvider(new ClaudeAuthReader()),
  new AntigravityProvider(new AntigravityAuthReader()),

  // API key providers (extend the unified BaseApiKeyProvider)
  new DeepSeekProvider(descriptor('deepseek')),
  new OpenRouterProvider(descriptor('openrouter')),
  new CommandCodeProvider(descriptor('commandcode')),
  new CopilotProvider(descriptor('copilot')),
  new WarpProvider(descriptor('warp')),
  new SyntheticProvider(descriptor('synthetic')),
  new ChutesProvider(descriptor('chutes')),
  new ZaiProvider(descriptor('zai')),
  new ElevenLabsProvider(descriptor('elevenlabs')),
  new AlibabaProvider(descriptor('alibaba')),
  new MiniMaxProvider(descriptor('minimax')),
  new KiloProvider(descriptor('kilo')),
  new CodebuffProvider(descriptor('codebuff')),
  new OpenAIProvider(descriptor('openai')),
  new VeniceProvider(descriptor('venice')),
  new ZenMuxProvider(descriptor('zenmux')),
  new CrofProvider(descriptor('crof')),
  new MoonshotProvider(descriptor('moonshot')),
  new PoeProvider(descriptor('poe')),
  new DeepgramProvider(descriptor('deepgram')),
]

/** Fast lookup by provider ID. */
export const getProvider = (id: string): IProvider | undefined =>
  ALL_PROVIDERS.find((p) => p.id === id)
