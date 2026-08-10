import { describe, it, expect, vi, afterEach } from 'vitest'
import nacl from 'tweetnacl'
import sealedbox, { overheadLength } from 'tweetnacl-sealedbox-js'
import { sealSecretValue, getRepoPublicKey, putRepoActionsSecret } from './github-actions-secrets'

afterEach(() => vi.restoreAllMocks())

// ── fetch mock helper (style matches vercel.test.ts / cloudflare.test.ts) ──────

type FetchCall = { url: string; init?: RequestInit }

function makeFetchSpy(responses: Array<{ status: number; body: unknown }>) {
  let idx = 0
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const { status, body } = responses[idx++] ?? { status: 200, body: {} }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    }
  }))
  return calls
}

function toBase64(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

// ── sealSecretValue — load-bearing crypto round-trip test ──────────────────────
//
// This is the test that actually proves sealSecretValue is a correct,
// GitHub-compatible sealed-box (crypto_box_seal) construction. We can't hit
// GitHub's real API in this sandbox, so instead: generate our own X25519
// keypair, seal a known plaintext with the *public* half via
// sealSecretValue (the function under test), then open it with
// tweetnacl-sealedbox-js's own `open` using the *secret* half. If the
// decrypted plaintext doesn't match, the seal construction is wrong —
// wrong nonce derivation, wrong ephemeral key layout, etc.

describe('sealSecretValue', () => {
  it('round-trips: sealed output opens with the matching secret key and recovers the plaintext', () => {
    const keyPair = nacl.box.keyPair()
    const publicKeyBase64 = toBase64(keyPair.publicKey)
    const plaintext = 'super-secret-cloudflare-api-token-value'

    const encryptedBase64 = sealSecretValue(publicKeyBase64, plaintext)

    // Decode our own output and open it with tweetnacl-sealedbox-js directly
    // (independent of sealSecretValue's own base64 helpers).
    const sealedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))
    const opened = sealedbox.open(sealedBytes, keyPair.publicKey, keyPair.secretKey)

    expect(opened).not.toBeNull()
    const recovered = new TextDecoder().decode(opened as Uint8Array)
    expect(recovered).toBe(plaintext)
  })

  it('produces ciphertext of length = sealedbox overhead (48 bytes) + plaintext length, base64-encoded', () => {
    const keyPair = nacl.box.keyPair()
    const publicKeyBase64 = toBase64(keyPair.publicKey)
    const plaintext = 'abc' // 3 bytes

    const encryptedBase64 = sealSecretValue(publicKeyBase64, plaintext)
    const sealedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))

    expect(overheadLength).toBe(48)
    expect(sealedBytes.length).toBe(48 + 3)
  })

  it('produces different ciphertext each time (random ephemeral key per seal)', () => {
    const keyPair = nacl.box.keyPair()
    const publicKeyBase64 = toBase64(keyPair.publicKey)

    const a = sealSecretValue(publicKeyBase64, 'same-plaintext')
    const b = sealSecretValue(publicKeyBase64, 'same-plaintext')

    expect(a).not.toBe(b)
  })

  it('fails to open (or produces garbage, not the original) with the wrong secret key', () => {
    const keyPair = nacl.box.keyPair()
    const wrongKeyPair = nacl.box.keyPair()
    const publicKeyBase64 = toBase64(keyPair.publicKey)
    const plaintext = 'sensitive-value'

    const encryptedBase64 = sealSecretValue(publicKeyBase64, plaintext)
    const sealedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))

    const opened = sealedbox.open(sealedBytes, keyPair.publicKey, wrongKeyPair.secretKey)
    expect(opened).toBeNull()
  })
})

// ── getRepoPublicKey ─────────────────────────────────────────────────────────

describe('getRepoPublicKey', () => {
  it('returns key + key_id on success', async () => {
    makeFetchSpy([{ status: 200, body: { key: 'base64key==', key_id: '123' } }])
    const result = await getRepoPublicKey('tok', 'owner/repo')
    expect(result).toEqual({ key: 'base64key==', key_id: '123' })
  })

  it('sends Bearer auth + required GitHub headers', async () => {
    const calls = makeFetchSpy([{ status: 200, body: { key: 'k', key_id: '1' } }])
    await getRepoPublicKey('my-token', 'owner/repo')
    const headers = (calls[0].init as RequestInit).headers as Record<string, string>
    expect(calls[0].url).toBe('https://api.github.com/repos/owner/repo/actions/secrets/public-key')
    expect(headers.Authorization).toBe('Bearer my-token')
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(headers.Accept).toBe('application/vnd.github+json')
  })

  it('throws with status + truncated body on failure', async () => {
    makeFetchSpy([{ status: 404, body: 'Not Found' }])
    await expect(getRepoPublicKey('tok', 'owner/repo')).rejects.toThrow(/404/)
  })

  it('redacts the token out of a failed response body', async () => {
    makeFetchSpy([{ status: 401, body: 'bad credentials: my-secret-token' }])
    await expect(
      getRepoPublicKey('my-secret-token', 'owner/repo'),
    ).rejects.toThrow(/\[REDACTED\]/)
  })
})

// ── putRepoActionsSecret ─────────────────────────────────────────────────────

describe('putRepoActionsSecret', () => {
  it('fetches the public key, seals the value, and PUTs it — treats 201 as success', async () => {
    const keyPair = nacl.box.keyPair()
    const publicKeyBase64 = toBase64(keyPair.publicKey)
    const calls = makeFetchSpy([
      { status: 200, body: { key: publicKeyBase64, key_id: 'key-id-1' } },
      { status: 201, body: {} },
    ])

    await putRepoActionsSecret('tok', 'owner/repo', 'CLOUDFLARE_API_TOKEN', 'my-secret-value')

    expect(calls).toHaveLength(2)
    expect(calls[1].url).toBe('https://api.github.com/repos/owner/repo/actions/secrets/CLOUDFLARE_API_TOKEN')
    expect((calls[1].init as RequestInit).method).toBe('PUT')

    const putBody = JSON.parse((calls[1].init as RequestInit).body as string) as {
      encrypted_value: string
      key_id: string
    }
    expect(putBody.key_id).toBe('key-id-1')

    // Verify what was actually sent to GitHub decrypts back to the original secret.
    const sealedBytes = Uint8Array.from(atob(putBody.encrypted_value), c => c.charCodeAt(0))
    const opened = sealedbox.open(sealedBytes, keyPair.publicKey, keyPair.secretKey)
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe('my-secret-value')
  })

  it('treats 204 as success', async () => {
    const keyPair = nacl.box.keyPair()
    makeFetchSpy([
      { status: 200, body: { key: toBase64(keyPair.publicKey), key_id: 'key-id-1' } },
      { status: 204, body: {} },
    ])
    await expect(
      putRepoActionsSecret('tok', 'owner/repo', 'CLOUDFLARE_ACCOUNT_ID', 'acct-id'),
    ).resolves.toBeUndefined()
  })

  it('throws with status + body when the PUT fails', async () => {
    const keyPair = nacl.box.keyPair()
    makeFetchSpy([
      { status: 200, body: { key: toBase64(keyPair.publicKey), key_id: 'key-id-1' } },
      { status: 422, body: 'Validation Failed' },
    ])
    await expect(
      putRepoActionsSecret('tok', 'owner/repo', 'BAD_SECRET', 'value'),
    ).rejects.toThrow(/422/)
  })

  it('throws before attempting PUT when the public-key fetch fails', async () => {
    const calls = makeFetchSpy([{ status: 403, body: 'Forbidden' }])
    await expect(
      putRepoActionsSecret('tok', 'owner/repo', 'X', 'value'),
    ).rejects.toThrow(/403/)
    expect(calls).toHaveLength(1)
  })

  it('redacts the token out of a failed PUT response body', async () => {
    const keyPair = nacl.box.keyPair()
    makeFetchSpy([
      { status: 200, body: { key: toBase64(keyPair.publicKey), key_id: 'key-id-1' } },
      { status: 401, body: 'bad credentials: my-github-token' },
    ])
    await expect(
      putRepoActionsSecret('my-github-token', 'owner/repo', 'X', 'value'),
    ).rejects.toThrow(/\[REDACTED\]/)
  })
})
