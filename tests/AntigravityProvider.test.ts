/**
 * @file AntigravityProvider.test.ts
 * @description Unit tests for AntigravityProvider plan resolution, initialization caching, and quota parsing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import AntigravityProvider, {
  readPlanLabel,
} from '../src/main/services/usage/providers/AntigravityProvider'
import type AntigravityAuthReader from '../src/main/services/usage/AntigravityAuthReader'
import type { AntigravityAuth } from '../src/main/services/usage/AntigravityAuthReader'

afterEach(() => {
  vi.unstubAllGlobals()
})

const sampleQuotaResponse = {
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        {
          bucketId: 'gemini-weekly',
          displayName: 'Weekly Limit Remaining',
          window: 'weekly',
          resetTime: new Date(Date.now() + 604_800_000).toISOString(),
          remainingFraction: 0.9,
        },
        {
          bucketId: 'gemini-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          resetTime: new Date(Date.now() + 18_000_000).toISOString(),
          remainingFraction: 0.8,
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      buckets: [
        {
          bucketId: '3p-5h',
          displayName: 'Five Hour Limit Remaining',
          window: '5h',
          resetTime: new Date(Date.now() + 18_000_000).toISOString(),
          remainingFraction: 0.0,
        },
      ],
    },
  ],
}

describe('readPlanLabel', () => {
  it('maps Google AI Pro tier tokens to Pro', () => {
    expect(readPlanLabel('g1-pro-tier')).toBe('Pro')
    expect(readPlanLabel('Google AI Pro')).toBe('Pro')
    expect(readPlanLabel('pro-tier')).toBe('Pro')
  })

  it('maps Google AI Ultra tier tokens to Ultra', () => {
    expect(readPlanLabel('g1-ultra-tier')).toBe('Ultra')
    expect(readPlanLabel('Google AI Ultra')).toBe('Ultra')
  })

  it('maps free and standard tiers accurately', () => {
    expect(readPlanLabel('free-tier')).toBe('Free')
    expect(readPlanLabel('standard-tier')).toBe('Standard')
    expect(readPlanLabel('enterprise-tier')).toBe('Enterprise')
  })

  it('handles null and whitespace-only inputs', () => {
    expect(readPlanLabel(null)).toBeNull()
    expect(readPlanLabel('')).toBeNull()
    expect(readPlanLabel('   ')).toBeNull()
  })

  it('capitalizes custom hyphenated tier names', () => {
    expect(readPlanLabel('developer-preview')).toBe('Developer')
  })
})

describe('AntigravityProvider', () => {
  const mockAuthReader: AntigravityAuthReader = {
    read: vi.fn(),
    save: vi.fn(),
  } as unknown as AntigravityAuthReader

  const auth: AntigravityAuth = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiry: new Date(Date.now() + 3_600_000).toISOString(),
  }

  it('resolves Pro plan when paidTier contains g1-pro-tier even if currentTier is free-tier', async () => {
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'aicode-consumers',
            currentTier: {
              id: 'free-tier',
              name: 'Antigravity',
            },
            paidTier: {
              id: 'g1-pro-tier',
              name: 'Google AI Pro',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'v1.0.14' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify(sampleQuotaResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchStub)

    const provider = new AntigravityProvider(mockAuthReader)
    const rawUsage = await (
      provider as unknown as { fetchUsage: (a: AntigravityAuth) => Promise<unknown> }
    ).fetchUsage(auth)
    const result = (
      provider as unknown as {
        buildResult: (raw: unknown, a: AntigravityAuth, now: Date) => unknown
      }
    ).buildResult(rawUsage, auth, new Date()) as {
      providerName: string
      plan: string | null
      windows: Array<{ label: string; usedPercent: number }>
    }

    expect(result.providerName).toBe('Antigravity')
    expect(result.plan).toBe('Pro')
    expect(result.windows.length).toBe(3)
  })

  it('resolves Free plan when paidTier is absent and currentTier is free-tier', async () => {
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'aicode-consumers',
            currentTier: {
              id: 'free-tier',
              name: 'Antigravity',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'v1.0.14' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify(sampleQuotaResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchStub)

    const provider = new AntigravityProvider(mockAuthReader)
    const rawUsage = await (
      provider as unknown as { fetchUsage: (a: AntigravityAuth) => Promise<unknown> }
    ).fetchUsage(auth)
    const result = (
      provider as unknown as {
        buildResult: (raw: unknown, a: AntigravityAuth, now: Date) => unknown
      }
    ).buildResult(rawUsage, auth, new Date()) as {
      providerName: string
      plan: string | null
      windows: Array<{ label: string; usedPercent: number }>
    }

    expect(result.plan).toBe('Free')
  })
})
