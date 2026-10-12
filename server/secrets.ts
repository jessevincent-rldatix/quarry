import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Encrypts the secrets Quarry writes to disk (saved passwords, the saved AI token).
 *
 * On Windows this is DPAPI, tied to your Windows login: the file is useless to another user or on
 * another machine. Elsewhere there is no equivalent without extra software, so a key kept in a
 * separate owner-only file is used. That stops the secret being read from the settings file alone
 * (a backup, a screen share, a paste), but not by something that can read the whole data folder.
 */
export interface Secrets {
  protect(plain: string): string
  /** Returns '' when the value cannot be read, for instance after the files moved to another machine. */
  reveal(stored: string): string
  /** True when the value is plain text from an older version and should be written again. */
  isPlain(stored: string): boolean
}

interface SecretsInternal extends Secrets { protectNow(plain: string): string }

const DPAPI = 'dpapi:'
const LOCAL = 'local:'

function powershell(script: string, input: string): string {
  // The secret travels on standard input, never on the command line, where other processes could see it.
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }).trim()
}

// Base64 in and out, so any character survives the console's text encoding.
const PROTECT = `Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`
const REVEAL = `Add-Type -AssemblyName System.Security; $b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`

export function createSecrets(dataDir: string): Secrets {
  const keyFile = path.join(dataDir, 'secret.key')
  const localKey = (): Buffer => {
    try {
      return fs.readFileSync(keyFile)
    } catch {
      const key = crypto.randomBytes(32)
      fs.writeFileSync(keyFile, key, { mode: 0o600 })
      return key
    }
  }

  const protectLocal = (plain: string): string => {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', localKey(), iv)
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return LOCAL + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  }

  const revealLocal = (stored: string): string => {
    const raw = Buffer.from(stored.slice(LOCAL.length), 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', localKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  }

  // Encrypting starts a helper process on Windows; remember results so each secret costs that once.
  const done = new Map<string, string>()

  const secrets: SecretsInternal = {
    protect(plain) {
      const known = done.get(plain)
      if (known) return known
      const stored = secrets.protectNow(plain)
      done.set(plain, stored)
      return stored
    },
    protectNow(plain: string): string {
      if (process.platform === 'win32') {
        try {
          return DPAPI + powershell(PROTECT, Buffer.from(plain, 'utf8').toString('base64'))
        } catch { /* fall through to the local key */ }
      }
      return protectLocal(plain)
    },
    reveal(stored) {
      try {
        if (stored.startsWith(DPAPI)) return Buffer.from(powershell(REVEAL, stored.slice(DPAPI.length)), 'base64').toString('utf8')
        if (stored.startsWith(LOCAL)) return revealLocal(stored)
        return stored
      } catch {
        return ''
      }
    },
    isPlain: (stored) => !stored.startsWith(DPAPI) && !stored.startsWith(LOCAL),
  }
  return secrets
}
