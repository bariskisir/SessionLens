/**
 * @file WindowStartRequestSender.ts
 * @description Discovers available dynamic AI models and sends minimal warm-up requests ("2+2") to start/arm session windows after a usage reset.
 */

import { platform } from 'node:os'
import type LoggerService from '../LoggerService'
import type CodexAuthReader from './CodexAuthReader'
import type ClaudeAuthReader from './ClaudeAuthReader'
import type AntigravityAuthReader from './AntigravityAuthReader'
import { ProviderError, getJsonWithHeaders, httpFetch } from './ProviderHttp'
import { getString, getBoolean, getObject } from './ProviderJson'

/** Endpoint for querying available Codex models. */
const CODXE_MODELS_ENDPOINT = 'https://chatgpt.com/backend-api/codex/models'
/** Endpoint for sending Codex completion requests. */
const CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
/** Endpoint for discovering latest OpenAI Codex CLI release version. */
const CODEX_LATEST_ENDPOINT = 'https://registry.npmjs.org/@openai/codex/latest'
/** Endpoint for querying available Claude models. */
const CLAUDE_MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
/** Endpoint for sending Claude completion messages. */
const CLAUDE_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages?beta=true'
/** Beta flag header for Claude metadata requests. */
const CLAUDE_META_BETA = 'oauth-2025-04-20'
/** Beta flag headers for Claude completion requests. */
const CLAUDE_CHAT_BETA = 'claude-code-20250219,oauth-2025-04-20'
/** Default system prompt identifying Claude CLI. */
const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude."
/** Base internal API URL for Google Antigravity Cloud Code backend. */
const ANTIGRAVITY_BASE_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'
/** GitHub API release URL for Antigravity CLI version lookup. */
const ANTIGRAVITY_RELEASES_ENDPOINT =
  'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest'
/** Default Antigravity CLI version fallback. */
const DEFAULT_ANTIGRAVITY_CLI_VERSION = '1.0.14'

/** A single warm-window start request parameter payload. */
export interface WindowStartRequest {
  providerName: string
  windowLabel: string
  windowSubLabel?: string | null
}

/** Representation of a dynamic model option parsed from provider APIs. */
interface DynamicModel {
  id: string
  hidden: boolean
  reasoningLevels: string[]
  recommended?: boolean
}

/**
 * Handles sending minimal warm-up prompts to AI model providers (Codex, Claude, Antigravity) to initiate new usage windows.
 */
export default class WindowStartRequestSender {
  /** Cached CLI version string for Antigravity user-agent header. */
  private cachedAntigravityCliVersion: string | null = null

  /**
   * Initializes a new instance of WindowStartRequestSender.
   *
   * @param codexAuthReader - Auth reader for Codex OAuth credentials
   * @param claudeAuthReader - Auth reader for Claude OAuth credentials
   * @param antigravityAuthReader - Auth reader for Antigravity credentials
   * @param logger - Service for logging system operations
   */
  public constructor(
    private readonly codexAuthReader: CodexAuthReader,
    private readonly claudeAuthReader: ClaudeAuthReader,
    private readonly antigravityAuthReader: AntigravityAuthReader,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Dispatches a warm-up start request for the specified provider.
   *
   * @param request - Window start request detailing provider and model selector
   * @throws ProviderError if the provider is unsupported or credentials/request fails
   */
  public async startAsync(request: WindowStartRequest): Promise<void> {
    switch (request.providerName.toLowerCase()) {
      case 'codex':
        await this.startCodexAsync()
        return
      case 'claude':
        await this.startClaudeAsync()
        return
      case 'antigravity':
        await this.startAntigravityAsync(request)
        return
      default:
        throw new ProviderError(`Window starting is not supported for ${request.providerName}.`)
    }
  }

  /** Sends a minimal completion request to OpenAI Codex. */
  private async startCodexAsync(): Promise<void> {
    const auth = await this.codexAuthReader.read()
    if (!auth) throw new ProviderError('Codex credentials were not found.')
    const version = await this.tryGetCodexVersionAsync()
    const modelsUrl = version
      ? `${CODXE_MODELS_ENDPOINT}?client_version=${encodeURIComponent(version)}`
      : CODXE_MODELS_ENDPOINT
    const headers = this.codexHeaders(auth.accessToken, auth.accountId, 'application/json', false)

    const modelsDocument = (await getJsonWithHeaders(modelsUrl, headers)) as Record<string, unknown>
    const models = this.parseCodexModels(modelsDocument)
    const model = this.firstUsableModel(models)

    const payload: Record<string, unknown> = {
      model: model.id,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '2+2' }],
        },
      ],
      stream: true,
      store: false,
      instructions: '.',
      text: { verbosity: 'low' },
    }
    const effort = [...model.reasoningLevels].sort(this.effortScore)[0]
    if (effort) {
      payload.reasoning = { effort, summary: 'auto' }
    }

    await this.sendAndDrain(
      'POST',
      CODEX_RESPONSES_ENDPOINT,
      payload,
      this.codexHeaders(auth.accessToken, auth.accountId, 'text/event-stream', true),
      'Codex window start',
    )
    this.logger.info('WindowStart', 'Codex warm-window request completed.', { model: model.id })
  }

  /** Sends a minimal completion request to Anthropic Claude. */
  private async startClaudeAsync(): Promise<void> {
    const auth = await this.claudeAuthReader.read()
    if (!auth) throw new ProviderError('Claude credentials were not found.')

    const modelsDocument = (await getJsonWithHeaders(
      CLAUDE_MODELS_ENDPOINT,
      this.claudeHeaders(auth.accessToken, CLAUDE_META_BETA, false),
    )) as Record<string, unknown>
    const model = this.firstUsableModel(this.parseClaudeModels(modelsDocument))

    const payload: Record<string, unknown> = {
      model: model.id,
      max_tokens: 128,
      stream: false,
      system: [{ type: 'text', text: CLAUDE_SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '2+2' }],
        },
      ],
    }

    await this.sendAndDrain(
      'POST',
      CLAUDE_MESSAGES_ENDPOINT,
      payload,
      this.claudeHeaders(auth.accessToken, CLAUDE_CHAT_BETA, true),
      'Claude window start',
    )
    this.logger.info('WindowStart', 'Claude warm-window request completed.', { model: model.id })
  }

  /**
   * Sends a minimal completion request to Google Antigravity Code Assist.
   *
   * @param request - Window start request with bucket and model information
   */
  private async startAntigravityAsync(request: WindowStartRequest): Promise<void> {
    const auth = await this.antigravityAuthReader.read()
    if (!auth) throw new ProviderError('Antigravity credentials were not found.')
    const cliVersion = await this.getAntigravityCliVersionAsync()
    const userAgent = this.antigravityUserAgent(cliVersion)

    const projectDocument = (await this.postJsonAndParse(
      `${ANTIGRAVITY_BASE_ENDPOINT}/v1internal:loadCodeAssist`,
      { metadata: { ideType: 'ANTIGRAVITY' } },
      this.antigravityHeaders(auth.accessToken, userAgent),
    )) as Record<string, unknown>
    const projectId = getString(projectDocument, 'cloudaicompanionProject')
    if (!projectId) {
      throw new ProviderError('Antigravity project lookup did not return a project id.')
    }

    const modelsDocument = (await this.postJsonAndParse(
      `${ANTIGRAVITY_BASE_ENDPOINT}/v1internal:fetchAvailableModels`,
      { project: projectId },
      this.antigravityHeaders(auth.accessToken, userAgent),
    )) as Record<string, unknown>
    const models = this.parseAntigravityModels(modelsDocument)
    const model = request.windowSubLabel
      ? this.selectAntigravityModelForBucket(models, request.windowSubLabel)
      : this.firstUsableModel(models)

    const requestId = `sessionlens-${crypto.randomUUID().replace(/-/g, '')}`
    let withThinking = model.reasoningLevels.length > 0
    for (;;) {
      const generationConfig = withThinking
        ? {
            thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
          }
        : {}
      const payload: Record<string, unknown> = {
        project: projectId,
        requestId,
        request: {
          contents: [
            {
              role: 'user',
              parts: [{ text: '2+2' }],
            },
          ],
          generationConfig,
          sessionId: `-${Date.now()}`,
        },
        model: model.id,
        userAgent: 'antigravity',
        requestType: 'checkpoint',
      }

      try {
        await this.sendAndDrain(
          'POST',
          `${ANTIGRAVITY_BASE_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`,
          payload,
          this.antigravityHeaders(auth.accessToken, userAgent),
          'Antigravity window start',
        )
        this.logger.info('WindowStart', 'Antigravity warm-window request completed.', {
          model: model.id,
        })
        return
      } catch (error) {
        if (error instanceof ProviderError && error.message.includes('HTTP 400') && withThinking) {
          withThinking = false
          continue
        }
        throw error
      }
    }
  }

  /**
   * Resolves the Antigravity CLI version from GitHub releases, or returns the default fallback.
   *
   * @returns Version string (e.g. "1.0.14")
   */
  private async getAntigravityCliVersionAsync(): Promise<string> {
    if (this.cachedAntigravityCliVersion !== null) return this.cachedAntigravityCliVersion
    try {
      const document = (await getJsonWithHeaders(ANTIGRAVITY_RELEASES_ENDPOINT, {
        Accept: 'application/json',
        'User-Agent': 'SessionLens',
      })) as Record<string, unknown>
      const tagName = getString(document, 'tag_name')
      if (tagName) {
        this.cachedAntigravityCliVersion = tagName.startsWith('v') ? tagName.slice(1) : tagName
        return this.cachedAntigravityCliVersion
      }
    } catch {
      // Version discovery is optional; fall back to the compatible default.
    }
    this.cachedAntigravityCliVersion = DEFAULT_ANTIGRAVITY_CLI_VERSION
    return this.cachedAntigravityCliVersion
  }

  /**
   * Attempts to fetch the latest Codex CLI release version from npm registry.
   *
   * @returns Version string or null if unavailable
   */
  private async tryGetCodexVersionAsync(): Promise<string | null> {
    try {
      const document = (await getJsonWithHeaders(CODEX_LATEST_ENDPOINT, {
        Accept: 'application/json',
      })) as Record<string, unknown>
      return getString(document, 'version')
    } catch {
      return null
    }
  }

  /**
   * Posts JSON payload to an endpoint and parses the response object.
   *
   * @param url - Target HTTP URL
   * @param payload - Request body content
   * @param headers - HTTP header map
   * @returns Parsed JSON document
   */
  private async postJsonAndParse(
    url: string,
    payload: unknown,
    headers: Record<string, string>,
  ): Promise<unknown> {
    const requestHeaders = { ...headers }
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] ?? 'application/json'
    const response = await httpFetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new ProviderError(
        `Provider request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}.`,
      )
    }
    return (await response.json()) as unknown
  }

  /**
   * Sends an HTTP request and consumes the body stream to completion.
   *
   * @param method - HTTP verb ('GET' or 'POST')
   * @param url - Target URL
   * @param payload - Request body payload for POST requests
   * @param headers - HTTP headers map
   * @param operation - Operation label for logging/error messages
   */
  private async sendAndDrain(
    method: string,
    url: string,
    payload: unknown,
    headers: Record<string, string>,
    operation: string,
  ): Promise<void> {
    const requestHeaders = { ...headers }
    if (method === 'POST') {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] ?? 'application/json'
    }
    const requestInit: RequestInit = { method, headers: requestHeaders }
    if (method === 'POST') requestInit.body = JSON.stringify(payload)
    const response = await httpFetch(url, requestInit)
    if (!response.ok) {
      const body = await response.text()
      throw new ProviderError(
        `${operation} failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}.`,
      )
    }
    await response.text()
  }

  /**
   * Constructs request headers for OpenAI Codex API calls.
   *
   * @param accessToken - Codex OAuth access token
   * @param accountId - Optional ChatGPT account ID
   * @param accept - Accept header MIME type
   * @param jsonContent - Flag indicating if request contains JSON body
   * @returns Header key-value map
   */
  private codexHeaders(
    accessToken: string,
    accountId: string | null | undefined,
    accept: string,
    jsonContent: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      Authorization: `Bearer ${accessToken}`,
      originator: 'codex_cli_rs',
      'User-Agent': 'SessionLens',
    }
    if (jsonContent) headers['OpenAI-Beta'] = 'responses=experimental'
    if (accountId) headers['ChatGPT-Account-Id'] = accountId
    return headers
  }

  /**
   * Constructs request headers for Anthropic Claude API calls.
   *
   * @param accessToken - Claude OAuth access token
   * @param beta - Anthropic beta feature header string
   * @param jsonContent - Flag indicating if request contains JSON body
   * @returns Header key-value map
   */
  private claudeHeaders(
    accessToken: string,
    beta: string,
    jsonContent: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': beta,
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-app': 'cli',
      'User-Agent': 'claude-cli (external, cli)',
    }
    if (jsonContent) headers['Content-Type'] = 'application/json'
    return headers
  }

  /**
   * Constructs request headers for Google Antigravity Cloud Code API calls.
   *
   * @param accessToken - Antigravity OAuth access token
   * @param userAgent - Formatted user agent string
   * @returns Header key-value map
   */
  private antigravityHeaders(accessToken: string, userAgent: string): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': userAgent,
    }
  }

  /**
   * Parses dynamic model objects from a Codex models endpoint response.
   *
   * @param root - Parsed JSON response root
   * @returns Array of dynamic model definitions
   */
  private parseCodexModels(root: Record<string, unknown>): DynamicModel[] {
    const models = root.models
    if (!Array.isArray(models)) return []
    return models
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return null
        const record = entry as Record<string, unknown>
        const id =
          getString(record, 'slug') ?? getString(record, 'model') ?? getString(record, 'id') ?? ''
        const reasoning = Array.isArray(record.supported_reasoning_levels)
          ? record.supported_reasoning_levels
              .map((level) =>
                typeof level === 'object' && level !== null ? getString(level, 'effort') : null,
              )
              .filter((value): value is string => Boolean(value))
          : []
        const hidden = getBoolean(record, 'hidden') || getString(record, 'visibility') === 'hide'
        return {
          id,
          hidden,
          reasoningLevels: reasoning,
        }
      })
      .filter((model): model is DynamicModel => model !== null && model.id !== '')
  }

  /**
   * Parses dynamic model objects from a Claude models endpoint response.
   *
   * @param root - Parsed JSON response root
   * @returns Array of dynamic model definitions
   */
  private parseClaudeModels(root: Record<string, unknown>): DynamicModel[] {
    const models = root.data
    if (!Array.isArray(models)) return []
    return models
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return null
        const record = entry as Record<string, unknown>
        const id = getString(record, 'id') ?? ''
        const capabilities = record.capabilities
        const effortCapability = getObject(capabilities, 'effort')
        const supportsEffort =
          effortCapability !== null && getBoolean(effortCapability, 'supported')
        return {
          id,
          hidden: false,
          reasoningLevels: supportsEffort ? ['low'] : [],
        }
      })
      .filter((model): model is DynamicModel => model !== null && model.id !== '')
  }

  /**
   * Parses dynamic model objects from an Antigravity fetchAvailableModels response.
   *
   * @param root - Parsed JSON response root
   * @returns Array of dynamic model definitions
   */
  private parseAntigravityModels(root: Record<string, unknown>): DynamicModel[] {
    const models = root.models
    if (typeof models !== 'object' || models === null || Array.isArray(models)) return []
    return Object.entries(models as Record<string, unknown>)
      .filter(([, value]) => {
        if (typeof value !== 'object' || value === null) return true
        return !getBoolean(value, 'isInternal')
      })
      .map(([name, value]) => {
        const record =
          typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
        return {
          id: name,
          hidden: false,
          reasoningLevels: getBoolean(record, 'supportsThinking') ? ['low'] : [],
          recommended: getBoolean(record, 'recommended'),
        }
      })
  }

  /**
   * Selects the first Antigravity model corresponding to a specific quota bucket label.
   *
   * @param models - Available dynamic models
   * @param bucketLabel - Target quota bucket label
   * @returns Selected dynamic model instance
   */
  private selectAntigravityModelForBucket(
    models: DynamicModel[],
    bucketLabel: string,
  ): DynamicModel {
    const bucketFamilies = new Set(
      this.modelFamilyWords(bucketLabel).map((word) => word.toLowerCase()),
    )
    const candidate = models
      .filter((model) => model.recommended)
      .find((model) => bucketFamilies.has(this.modelFamily(model.id)))
    if (!candidate) {
      throw new ProviderError(
        `Antigravity quota group '${bucketLabel}' did not contain a matching recommended quota-tracked model.`,
      )
    }
    return candidate
  }

  /**
   * Extracts the primary family name token from a model ID string.
   *
   * @param modelId - Full model ID
   * @returns Primary family token string
   */
  private modelFamily(modelId: string): string {
    return this.modelFamilyWords(modelId)[0] ?? ''
  }

  /**
   * Splits a model string into individual alphanumeric family keywords.
   *
   * @param value - Model ID or label string
   * @returns Array of keyword strings
   */
  private modelFamilyWords(value: string): string[] {
    const ignored = new Set(['and', 'model', 'models', 'quota'])
    const separators = [
      ...new Set(value.split('').filter((character) => !/[a-z0-9]/i.test(character))),
    ]
    const words = value
      .split(separators.length > 0 ? new RegExp(`[${escapeRegExp(separators.join(''))}]`) : /\s+/)
      .filter((word) => word.trim() !== '')
      .map((word) => word.trim())
    return words.filter((word) => word.length >= 3 && !ignored.has(word.toLowerCase()))
  }

  /**
   * Selects the first usable model exactly as the provider returned it.
   *
   * Warm-up requests are a fixed "2+2" prompt, so the lightest-model heuristics
   * are unnecessary; any visible model can arm the session window.
   *
   * @param models - Candidate model list in provider order
   * @returns First visible model
   */
  private firstUsableModel(models: DynamicModel[]): DynamicModel {
    const model = models.find((candidate) => !candidate.hidden)
    if (!model) {
      throw new ProviderError('The dynamic model catalog did not contain a usable model.')
    }
    return model
  }

  /**
   * Compares reasoning effort level strings.
   *
   * @param left - First effort string
   * @param right - Second effort string
   * @returns Negative if left < right, positive if left > right
   */
  private effortScore(left: string, right: string): number {
    const score = (value: string): number => {
      switch (value.toLowerCase()) {
        case 'none':
          return 0
        case 'minimal':
          return 1
        case 'low':
          return 2
        case 'medium':
          return 3
        case 'high':
          return 4
        case 'xhigh':
          return 5
        case 'max':
          return 6
        default:
          return 10
      }
    }
    return score(left) - score(right)
  }

  /**
   * Formats user-agent string required by Antigravity endpoints.
   *
   * @param cliVersion - CLI version string
   * @returns Formatted user-agent header value
   */
  private antigravityUserAgent(cliVersion: string): string {
    const currentPlatform = platform()
    const os =
      currentPlatform === 'win32' ? 'windows' : currentPlatform === 'darwin' ? 'darwin' : 'linux'
    const architecture =
      process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : process.arch
    return `antigravity/cli/${cliVersion} (aidev_client; os_type=${os}; arch=${architecture})`
  }
}

/**
 * Escapes special regular expression characters in a raw string.
 *
 * @param value - Input string to escape
 * @returns Escaped regex string
 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
