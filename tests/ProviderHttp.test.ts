/**
 * Verifies ProviderHttp routes requests through the Node fetch fallback outside Electron
 * and raises ProviderError on HTTP error statuses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getJson, postJson } from '../src/main/services/usage/ProviderHttp'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProviderHttp', () => {
  it('uses the Node fetch fallback outside Electron', async () => {
    const stub = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', stub)
    const result = await getJson(new Request('https://example.com/usage'))
    expect(result).toEqual({ ok: true })
    expect(stub).toHaveBeenCalledOnce()
  })

  it('throws ProviderError with the HTTP status on error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(getJson(new Request('https://example.com/usage'))).rejects.toThrow(
      'Provider request failed with HTTP 401: unauthorized.',
    )
  })

  it('returns the raw response for webhook posts', async () => {
    const response = new Response('accepted', { status: 202 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )
    await expect(postJson('https://example.com/hook', { ping: true })).resolves.toBe(response)
  })
})
