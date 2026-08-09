// `tweetnacl-sealedbox-js` ships no type declarations. Minimal ambient
// module declaration covering only the surface this codebase uses
// (crypto_box_seal construction on top of tweetnacl).
declare module 'tweetnacl-sealedbox-js' {
  function seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array
  function open(ciphertext: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null
  const overheadLength: number

  const _default: { seal: typeof seal; open: typeof open }
  export default _default
  export { seal, open, overheadLength }
}
