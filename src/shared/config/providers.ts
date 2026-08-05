/**
 * @file providers.ts
 * @description Static provider descriptor catalog and derived lookup helpers.
 */

import type { ProviderDescriptor } from '../types'

/** Registered provider catalog ordered by settings order then display order. */
export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  {
    id: 'codex',
    name: 'Codex',
    displayOrder: 0,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 0,
    iconKey: 'openai',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    displayOrder: 10,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 1,
    iconKey: 'claude',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    displayOrder: 5,
    authenticationKind: 'oauth',
    credentialName: null,
    settingsOrder: 2,
    iconKey: 'antigravity',
    startWindowAfterReset: true,
    barProvider: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    displayOrder: 100,
    authenticationKind: 'apiKey',
    credentialName: 'DEEPSEEK_API_KEY',
    settingsOrder: 3,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    displayOrder: 110,
    authenticationKind: 'apiKey',
    credentialName: 'OPENROUTER_API_KEY',
    settingsOrder: 4,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    displayOrder: 6,
    authenticationKind: 'apiKey',
    credentialName: 'COMMANDCODE_API_KEY',
    settingsOrder: 5,
    iconKey: 'commandcode',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    displayOrder: 5,
    authenticationKind: 'apiKey',
    credentialName: 'COPILOT_API_KEY',
    settingsOrder: 12,
    iconKey: 'copilot',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'warp',
    name: 'Warp',
    displayOrder: 13,
    authenticationKind: 'apiKey',
    credentialName: 'WARP_API_KEY',
    settingsOrder: 15,
    iconKey: 'warp',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'synthetic',
    name: 'Synthetic',
    displayOrder: 15,
    authenticationKind: 'apiKey',
    credentialName: 'SYNTHETIC_API_KEY',
    settingsOrder: 17,
    iconKey: 'synthetic',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'chutes',
    name: 'Chutes',
    displayOrder: 17,
    authenticationKind: 'apiKey',
    credentialName: 'CHUTES_API_KEY',
    settingsOrder: 18,
    iconKey: 'chutes',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'zai',
    name: 'Zai',
    displayOrder: 19,
    authenticationKind: 'apiKey',
    credentialName: 'ZAI_API_KEY',
    settingsOrder: 16,
    iconKey: 'zai',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    displayOrder: 20,
    authenticationKind: 'apiKey',
    credentialName: 'ELEVENLABS_API_KEY',
    settingsOrder: 8,
    iconKey: 'elevenlabs',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'alibaba',
    name: 'Alibaba',
    displayOrder: 23,
    authenticationKind: 'apiKey',
    credentialName: 'ALIBABA_API_KEY',
    settingsOrder: 21,
    iconKey: 'alibaba',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    displayOrder: 25,
    authenticationKind: 'apiKey',
    credentialName: 'MINIMAX_API_KEY',
    settingsOrder: 19,
    iconKey: 'minimax',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'kilo',
    name: 'Kilo',
    displayOrder: 30,
    authenticationKind: 'apiKey',
    credentialName: 'KILO_API_KEY',
    settingsOrder: 9,
    iconKey: 'kilo',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'codebuff',
    name: 'Codebuff',
    displayOrder: 40,
    authenticationKind: 'apiKey',
    credentialName: 'CODEBUFF_API_KEY',
    settingsOrder: 22,
    iconKey: 'codebuff',
    startWindowAfterReset: false,
    barProvider: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    displayOrder: 105,
    authenticationKind: 'apiKey',
    credentialName: 'OPENAI_API_KEY',
    settingsOrder: 10,
    iconKey: 'openai',
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'venice',
    name: 'Venice',
    displayOrder: 108,
    authenticationKind: 'apiKey',
    credentialName: 'VENICE_API_KEY',
    settingsOrder: 11,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'zenmux',
    name: 'ZenMux',
    displayOrder: 111,
    authenticationKind: 'apiKey',
    credentialName: 'ZENMUX_MANAGEMENT_API_KEY',
    settingsOrder: 6,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'crof',
    name: 'Crof',
    displayOrder: 112,
    authenticationKind: 'apiKey',
    credentialName: 'CROF_API_KEY',
    settingsOrder: 13,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    displayOrder: 115,
    authenticationKind: 'apiKey',
    credentialName: 'MOONSHOT_API_KEY',
    settingsOrder: 7,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'poe',
    name: 'Poe',
    displayOrder: 118,
    authenticationKind: 'apiKey',
    credentialName: 'POE_API_KEY',
    settingsOrder: 20,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    displayOrder: 120,
    authenticationKind: 'apiKey',
    credentialName: 'DEEPGRAM_API_KEY',
    settingsOrder: 14,
    iconKey: null,
    startWindowAfterReset: false,
    barProvider: false,
  },
]

/** Fast lookup: provider ID → descriptor. */
export const providerDescriptorMap = new Map<string, ProviderDescriptor>(
  PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
)

/** Set of provider names whose metrics can render as tray icon bars. */
export const barProviderNames = new Set(
  PROVIDER_DESCRIPTORS.filter((descriptor) => descriptor.barProvider).map(
    (descriptor) => descriptor.name,
  ),
)

/**
 * Returns the provider descriptor for a given ID, or undefined.
 *
 * @param id - Provider ID string
 * @returns Matching ProviderDescriptor or undefined
 */
export const getProviderDescriptor = (id: string): ProviderDescriptor | undefined =>
  providerDescriptorMap.get(id)

/**
 * Returns the icon key for a given provider name, normalized to lowercase without spaces.
 *
 * @param providerName - Display name or ID of the provider
 * @returns Icon SVG key string or null
 */
export const providerIconKey = (providerName: string): string | null => {
  const normalized = providerName.toLowerCase().replace(/\s+/g, '')
  return getProviderDescriptor(normalized)?.iconKey ?? null
}
