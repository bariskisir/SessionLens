/**
 * @file RefuselessProvider.test.ts
 * @description Unit tests for Refuseless credit balance parsing and unit-aware currency formatting.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import RefuselessProvider from '../src/main/services/usage/providers/RefuselessProvider'
import { PROVIDER_DESCRIPTORS } from '../src/shared/types'
import type { ProviderQueryContext } from '../src/main/providers/IProvider'

const descriptor = PROVIDER_DESCRIPTORS.find((entry) => entry.id === 'refuseless')
if (!descriptor) throw new Error('Missing Refuseless provider descriptor.')

const context: ProviderQueryContext = {
  now: new Date('2026-11-05T12:00:00.000Z'),
  apiKeys: new Map([['REFUSELESS_API_KEY', 'test-key']]),
  refreshTokenMap: new Map(),
}

const stubFetch = (payload: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RefuselessProvider', () => {
  it('displays a USD balance with the dollar symbol', async () => {
    stubFetch({
      object: 'credits',
      balance: 42.5,
      reserved: 1.2,
      available: 41.3,
      key_limit: null,
      unit: 'usd',
      updated_at: 1_793_836_800,
    })

    const result = await new RefuselessProvider(descriptor).query(context)

    expect(result).toMatchObject({
      providerName: 'Refuseless',
      balanceText: '$42.50',
      usdAmount: 42.5,
      cnyAmount: null,
    })
  })

  it('uses the symbol matching another currency unit', async () => {
    stubFetch({ balance: 12.5, unit: 'eur', updated_at: 1_793_836_800 })

    const result = await new RefuselessProvider(descriptor).query(context)

    expect(result).toMatchObject({
      balanceText: '€12.50',
      usdAmount: null,
    })
  })

  it('falls back to the raw unit label when no symbol is known', async () => {
    stubFetch({ balance: 7, unit: 'credits', updated_at: 1_793_836_800 })

    const result = await new RefuselessProvider(descriptor).query(context)

    expect(result).toMatchObject({
      balanceText: '7.00 credits',
      usdAmount: null,
    })
  })

  it('throws when the response has no balance', async () => {
    stubFetch({ object: 'credits', unit: 'usd', updated_at: 1_793_836_800 })

    await expect(new RefuselessProvider(descriptor).query(context)).rejects.toThrow(
      'Refuseless response did not contain balance.',
    )
  })
})
