import { pbkdf2 } from "@noble/hashes/pbkdf2.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

const PASSWORD_ITERATIONS = 100_000

export function randomSalt() {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  return bytesToHex(salt)
}

export function hashPassword(password: string, salt: string) {
  return bytesToHex(
    pbkdf2(sha256, utf8ToBytes(password), utf8ToBytes(salt), {
      c: PASSWORD_ITERATIONS,
      dkLen: 32,
    }),
  )
}

export function hashToken(token: string) {
  return bytesToHex(sha256(utf8ToBytes(token)))
}
