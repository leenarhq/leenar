// AES-256-GCM encrypt/decrypt for OAuth tokens
// ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)
//
// Ciphertext format: "v1:<base64(iv)>:<base64(ciphertext)>"
// Legacy format (no version prefix): "<base64(iv)>:<base64(ciphertext)>" — read-only support

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('ENCRYPTION_KEY contains non-hex characters')
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return arr
}

const _keyCache = new Map<string, CryptoKey>()

async function getKey(hexKey: string): Promise<CryptoKey> {
  if (hexKey.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  const cached = _keyCache.get(hexKey)
  if (cached) return cached
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), 'AES-GCM', false, ['encrypt', 'decrypt'])
  _keyCache.set(hexKey, key)
  return key
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str)
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const key = await getKey(hexKey)
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return `v1:${b64(iv)}:${b64(enc)}`
}

export async function decrypt(ciphertext: string, hexKey: string): Promise<string> {
  const key = await getKey(hexKey)

  let ivB64: string, encB64: string

  if (ciphertext.startsWith('v1:')) {
    // Current format: v1:<iv>:<ciphertext>
    const parts = ciphertext.slice(3).split(':')
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid ciphertext format')
    ;[ivB64, encB64] = parts
  } else {
    // Legacy format: <iv>:<ciphertext> — backwards-compatible read
    const parts = ciphertext.split(':')
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid ciphertext format')
    ;[ivB64, encB64] = parts
  }

  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(ivB64) },
    key,
    fromB64(encB64),
  )
  return new TextDecoder().decode(dec)
}
