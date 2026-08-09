// GitHub Actions repo secrets connector.
//
// GitHub's repo-level Actions secrets API requires client-side encryption
// before the value is ever sent over the wire: the caller fetches a
// per-repo X25519 public key, then encrypts ("seals") the secret value
// with libsodium's crypto_box_seal construction before PUTting it.
//
// WebCrypto does not implement crypto_box_seal (no X25519 sealed-box
// primitive, no BLAKE2b nonce derivation), so this file uses
// `tweetnacl` (box primitives) + `tweetnacl-sealedbox-js` (the
// sealed-box construction on top of tweetnacl) — both are pure JS and
// run fine in the Workers runtime.
//
// This module takes an already-resolved GitHub token as a parameter
// rather than re-deriving JWT/installation auth itself — see
// `connectors/github-app.ts` for that flow. Keeping auth resolution out
// of this file keeps its own unit tests free of JWT-signing mocks.

import sealedbox from 'tweetnacl-sealedbox-js'
import { createLogger } from '../logger'
import { redactSecretsFromText } from '../utils'

const GH_API = 'https://api.github.com'
const log = createLogger({ connector: 'github-actions-secrets' })

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'Leenar/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

/**
 * Seal `secretValue` (UTF-8) with the repo's X25519 public key, using
 * libsodium's crypto_box_seal construction, and return it base64-encoded —
 * this is the `encrypted_value` GitHub's Actions secrets API expects.
 *
 * Pure function: no I/O.
 */
export function sealSecretValue(publicKeyBase64: string, secretValue: string): string {
  const publicKey = base64ToBytes(publicKeyBase64)
  const message = new TextEncoder().encode(secretValue)
  const sealed = sealedbox.seal(message, publicKey)
  return bytesToBase64(sealed)
}

/** Fetch the repo's Actions secrets public key (used to seal secret values for that repo). */
export async function getRepoPublicKey(
  token: string,
  repoFullName: string,
): Promise<{ key: string; key_id: string }> {
  const res = await fetch(`${GH_API}/repos/${repoFullName}/actions/secrets/public-key`, {
    headers: ghHeaders(token),
  })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token])
    throw new Error(`GitHub Actions public key fetch failed: ${res.status} ${err.slice(0, 100)}`)
  }
  return res.json<{ key: string; key_id: string }>()
}

/**
 * Create or update a GitHub Actions repo secret. Fetches the repo's public
 * key, seals `secretValue` client-side, and PUTs the encrypted value.
 * GitHub returns 201 (created) or 204 (updated) on success.
 */
export async function putRepoActionsSecret(
  token: string,
  repoFullName: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  const { key, key_id } = await getRepoPublicKey(token, repoFullName)
  const encrypted_value = sealSecretValue(key, secretValue)

  const res = await fetch(`${GH_API}/repos/${repoFullName}/actions/secrets/${secretName}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({ encrypted_value, key_id }),
  })
  if (!res.ok) {
    const err = redactSecretsFromText(await res.text(), [token, secretValue])
    throw new Error(`GitHub Actions secret write failed: ${res.status} ${err.slice(0, 100)}`)
  }
  log.info('secret.written', { repoFullName, secretName })
}
