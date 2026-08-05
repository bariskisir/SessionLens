/**
 * @file AntigravityAuthReader.ts
 * @description Reads and persists Antigravity (Gemini Code Assist) OAuth credentials from the OS native credential store (Windows Credential Manager, macOS Keychain, Linux libsecret).
 */

import { execFile } from 'node:child_process'
import { platform } from 'node:os'

/** Antigravity OAuth credential material required to query usage. */
export interface AntigravityAuth {
  accessToken: string
  refreshToken?: string | null | undefined
  expiry?: string | null | undefined
  idToken?: string | null | undefined
}

/** Target credential key name used by Antigravity CLI in system store. */
const CREDENTIAL_TARGET = 'gemini:antigravity'
/** Execution timeout in milliseconds for native helper subprocess calls. */
const COMMAND_TIMEOUT_MS = 5_000

/**
 * Checks whether an unknown value is a non-null plain object.
 *
 * @param value - Value to check
 * @returns True if value is a record object
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Parses and validates an ISO expiry date string.
 *
 * @param value - Unknown property value
 * @returns Valid ISO string or null
 */
const parseExpiry = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : value
}

/**
 * Parses raw JSON string retrieved from the platform credential store into AntigravityAuth object.
 *
 * @param json - Credential JSON payload
 * @returns AntigravityAuth instance or null if parsing fails
 */
const parseAuth = (json: string): AntigravityAuth | null => {
  try {
    const file = JSON.parse(json) as unknown
    if (!isObject(file)) return null
    const token = file.token
    if (!isObject(token)) return null
    const accessToken = token.access_token
    if (typeof accessToken !== 'string' || accessToken.trim() === '') return null
    const refreshToken = token.refresh_token
    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
      expiry: parseExpiry(token.expiry),
      idToken: typeof token.id_token === 'string' ? token.id_token : null,
    }
  } catch {
    return null
  }
}

/**
 * Serializes AntigravityAuth object back to JSON payload for credential store.
 *
 * @param auth - Authentication object to serialize
 * @returns Formatted JSON string
 */
const serializeAuth = (auth: AntigravityAuth): string => {
  const token: Record<string, string> = {
    access_token: auth.accessToken,
    token_type: 'Bearer',
  }
  if (auth.refreshToken) token.refresh_token = auth.refreshToken
  if (auth.expiry) token.expiry = auth.expiry
  if (auth.idToken) token.id_token = auth.idToken
  return JSON.stringify({ token, auth_method: 'consumer' })
}

/**
 * Executes a native system process and returns its stdout string.
 *
 * @param file - Executable path or command name
 * @param args - Command line arguments
 * @param input - Optional stdin input string
 * @returns Trimmed stdout string or null on failure
 */
const runCommand = (file: string, args: string[], input?: string): Promise<string | null> =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, ...(input !== undefined ? {} : {}) },
      (error, stdout) => {
        if (error || stdout.trim() === '') {
          resolve(null)
          return
        }
        resolve(stdout.trim())
      },
    )
    if (input !== undefined) {
      child.stdin?.write(input)
      child.stdin?.end()
    }
  })

/**
 * Reads the `gemini:antigravity` credential through Windows Credential Manager using a
 * PowerShell P/Invoke wrapper around advapi32 CredRead.
 *
 * @returns Credential string or null if not found
 */
const readWindowsCredential = async (): Promise<string | null> => {
  const csharp = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class SessionLensCredMan {',
    '  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]',
    '  public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);',
    '  [DllImport("advapi32.dll", SetLastError=true)]',
    '  public static extern bool CredFree(IntPtr credential);',
    '}',
  ]
    .join('\n')
    .replace(/'/g, "''")
  const script = [
    `Add-Type -TypeDefinition '${csharp}'`,
    '$ptr = [IntPtr]::Zero',
    'if ([SessionLensCredMan]::CredRead("' +
      CREDENTIAL_TARGET.replace(/"/g, '""') +
      '", 1, 0, [ref]$ptr)) {',
    '  try {',
    '    $is64 = [IntPtr]::Size -eq 8',
    '    $blobSizeOffset = $(if ($is64) { 32 } else { 24 })',
    '    $blobPtrOffset = $(if ($is64) { 40 } else { 28 })',
    '    $blobSize = [System.Runtime.InteropServices.Marshal]::ReadInt32($ptr, $blobSizeOffset)',
    '    $blobPtr = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, $blobPtrOffset)',
    '    if ($blobSize -gt 0 -and $blobPtr -ne [IntPtr]::Zero) {',
    '      $bytes = New-Object byte[] $blobSize',
    '      [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $blobSize)',
    '      if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {',
    '        Write-Output ([System.Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0))',
    '      } else {',
    '        Write-Output ([System.Text.Encoding]::UTF8.GetString($bytes).TrimEnd([char]0))',
    '      }',
    '    }',
    '  } finally {',
    '    [void][SessionLensCredMan]::CredFree($ptr)',
    '  }',
    '}',
  ].join('\n')
  return runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
}

/**
 * Stores the credential into Windows Credential Manager via PowerShell P/Invoke around
 * advapi32 CredWrite.
 *
 * @param json - Credential JSON payload string to write
 * @returns True if writing succeeded
 */
const writeWindowsCredential = async (json: string): Promise<boolean> => {
  const escapedJson = json.replace(/`/g, '``').replace(/'/g, "''")
  const csharp = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class SessionLensCredManWrite {',
    '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
    '  public struct CREDENTIAL {',
    '    public uint Flags;',
    '    public uint Type;',
    '    public IntPtr TargetName;',
    '    public IntPtr Comment;',
    '    public long LastWritten;',
    '    public uint CredentialBlobSize;',
    '    public IntPtr CredentialBlob;',
    '    public uint Persist;',
    '    public uint AttributeCount;',
    '    public IntPtr Attributes;',
    '    public IntPtr TargetAlias;',
    '    public IntPtr UserName;',
    '  }',
    '  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]',
    '  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);',
    '  [DllImport("advapi32.dll", SetLastError=true)]',
    '  public static extern bool CredFree(IntPtr credential);',
    '}',
  ]
    .join('\n')
    .replace(/'/g, "''")
  const script = [
    `Add-Type -TypeDefinition '${csharp}'`,
    `$json = '${escapedJson}'`,
    '$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)',
    '$cred = New-Object SessionLensCredManWrite+CREDENTIAL',
    '$cred.Type = 1',
    '$cred.TargetName = [System.Runtime.InteropServices.Marshal]::StringToCoTaskMemUni("' +
      CREDENTIAL_TARGET.replace(/"/g, '""') +
      '")',
    '$cred.CredentialBlobSize = [uint32]$bytes.Length',
    '$cred.CredentialBlob = [System.Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)',
    '$cred.Persist = 3',
    '$cred.UserName = [System.Runtime.InteropServices.Marshal]::StringToCoTaskMemUni("")',
    '[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $cred.CredentialBlob, $bytes.Length)',
    'try {',
    '  $ok = [SessionLensCredManWrite]::CredWrite([ref]$cred, 0)',
    '  if ($ok) { Write-Output "ok" }',
    '} finally {',
    '  [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($cred.TargetName)',
    '  [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($cred.CredentialBlob)',
    '  [System.Runtime.InteropServices.Marshal]::FreeCoTaskMem($cred.UserName)',
    '}',
  ].join('\n')
  const result = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  return result === 'ok'
}

/**
 * Service for reading and persisting Antigravity (Gemini Code Assist) credentials from system keychains.
 */
export default class AntigravityAuthReader {
  /**
   * Returns the current auth from the platform credential store, or null when unavailable.
   *
   * @returns AntigravityAuth object or null
   */
  public async read(): Promise<AntigravityAuth | null> {
    try {
      const json = await this.readCredential()
      return json !== null ? parseAuth(json) : null
    } catch {
      return null
    }
  }

  /**
   * Persists refreshed OAuth material back to the platform credential store.
   *
   * @param auth - Updated AntigravityAuth object to write
   */
  public async save(auth: AntigravityAuth): Promise<void> {
    try {
      await this.writeCredential(serializeAuth(auth))
    } catch {
      // The refreshed credential remains valid for this query even if persistence fails.
    }
  }

  /**
   * Dispatches OS-specific credential read implementation.
   *
   * @returns Raw credential string or null
   */
  private async readCredential(): Promise<string | null> {
    const currentPlatform = platform()
    if (currentPlatform === 'win32') {
      return readWindowsCredential()
    }
    if (currentPlatform === 'darwin') {
      return runCommand('security', [
        'find-generic-password',
        '-s',
        CREDENTIAL_TARGET,
        '-a',
        'antigravity',
        '-w',
      ])
    }
    return runCommand('secret-tool', [
      'lookup',
      'application',
      'antigravity',
      'target',
      CREDENTIAL_TARGET,
    ])
  }

  /**
   * Dispatches OS-specific credential write implementation.
   *
   * @param json - Credential JSON payload string
   */
  private async writeCredential(json: string): Promise<void> {
    const currentPlatform = platform()
    if (currentPlatform === 'win32') {
      await writeWindowsCredential(json)
      return
    }
    if (currentPlatform === 'darwin') {
      await runCommand('security', [
        'delete-generic-password',
        '-s',
        CREDENTIAL_TARGET,
      ]).catch(() => null)
      await runCommand('security', [
        'add-generic-password',
        '-s',
        CREDENTIAL_TARGET,
        '-a',
        'antigravity',
        '-w',
        json,
        '-U',
      ])
      return
    }
    const child = execFile(
      'secret-tool',
      ['store', `--label=${CREDENTIAL_TARGET}`, 'application', 'antigravity', 'target', CREDENTIAL_TARGET],
      { timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
      () => undefined,
    )
    child.stdin?.write(json)
    child.stdin?.end()
  }
}

