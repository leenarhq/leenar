import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto'

const KEY = 'a'.repeat(64)  // 32-byte hex

describe('crypto', () => {
  it('round-trips a plaintext value', async () => {
    const plain = 'super-secret-token-12345'
    const cipher = await encrypt(plain, KEY)
    expect(cipher).toMatch(/^v1:/)
    const result = await decrypt(cipher, KEY)
    expect(result).toBe(plain)
  })

  it('produces different ciphertexts each time (random IV)', async () => {
    const a = await encrypt('same', KEY)
    const b = await encrypt('same', KEY)
    expect(a).not.toBe(b)
  })

  it('decrypts legacy format (no version prefix)', async () => {
    // Simulate old format: base64(iv):base64(ciphertext)
    // We can generate one by stripping the v1: prefix
    const plain = 'legacy-value'
    const modern = await encrypt(plain, KEY)
    const legacy = modern.slice(3)  // strip "v1:"
    const result = await decrypt(legacy, KEY)
    expect(result).toBe(plain)
  })

  it('throws on wrong key', async () => {
    const cipher = await encrypt('secret', KEY)
    const badKey = 'b'.repeat(64)
    await expect(decrypt(cipher, badKey)).rejects.toThrow()
  })

  it('throws on invalid format', async () => {
    await expect(decrypt('notvalid', KEY)).rejects.toThrow('Invalid ciphertext format')
  })

  it('throws if key is not 64 hex chars', async () => {
    await expect(encrypt('x', 'tooshort')).rejects.toThrow('ENCRYPTION_KEY must be 64 hex characters')
  })
})
