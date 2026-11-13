/**
 * @file WindowStartRequestSender.test.ts
 * @description Unit tests for warm-window model selection: the first model returned by each provider is used.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import WindowStartRequestSender from '../src/main/services/usage/WindowStartRequestSender'
import type CodexAuthReader from '../src/main/services/usage/CodexAuthReader'
import type ClaudeAuthReader from '../src/main/services/usage/ClaudeAuthReader'
import type AntigravityAuthReader from '../src/main/services/usage/AntigravityAuthReader'
import type LoggerService from '../src/main/services/LoggerService'

afterEach(() => {
  vi.unstubAllGlobals()
})

const createLogger = (): LoggerService =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as LoggerService

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const requestUrl = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()

const createSender = (codexAuth: unknown, claudeAuth: unknown): WindowStartRequestSender => {
  const codexReader = { read: vi.fn().mockResolvedValue(codexAuth) } as unknown as CodexAuthReader
  const claudeReader = {
    read: vi.fn().mockResolvedValue(claudeAuth),
  } as unknown as ClaudeAuthReader
  const antigravityReader = {
    read: vi.fn().mockResolvedValue(null),
  } as unknown as AntigravityAuthReader
  return new WindowStartRequestSender(codexReader, claudeReader, antigravityReader, createLogger())
}

describe('WindowStartRequestSender', () => {
  it('uses the first model returned by the Codex catalog', async () => {
    const capturedModels: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.includes('registry.npmjs.org')) return jsonResponse({ version: '1.0.0' })
        if (url.includes('/codex/models')) {
          return jsonResponse({
            models: [{ slug: 'first-codex-model' }, { slug: 'second-codex-model' }],
          })
        }
        if (url.includes('/codex/responses')) {
          const body = JSON.parse(String(init?.body)) as { model: string }
          capturedModels.push(body.model)
          return new Response('', { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      }),
    )

    const sender = createSender({ accessToken: 'codex-token', accountId: 'account' }, null)
    await sender.startAsync({
      providerName: 'codex',
      windowLabel: 'Session',
      windowSubLabel: null,
    })

    expect(capturedModels).toEqual(['first-codex-model'])
  })

  it('uses the first model returned by the Claude catalog', async () => {
    const capturedModels: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = requestUrl(input)
        if (url.includes('/v1/models')) {
          return jsonResponse({
            data: [{ id: 'first-claude-model' }, { id: 'second-claude-model' }],
          })
        }
        if (url.includes('/v1/messages')) {
          const body = JSON.parse(String(init?.body)) as { model: string }
          capturedModels.push(body.model)
          return jsonResponse({})
        }
        return new Response('Not found', { status: 404 })
      }),
    )

    const sender = createSender(null, { accessToken: 'claude-token' })
    await sender.startAsync({
      providerName: 'claude',
      windowLabel: 'Session',
      windowSubLabel: null,
    })

    expect(capturedModels).toEqual(['first-claude-model'])
  })
})
