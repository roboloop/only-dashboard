/**
 * Random-value and PKCE helpers, built on the WebCrypto that workerd exposes
 * globally. No dependencies, and nothing here is Node-specific.
 */

const BASE64URL_UNSAFE = /[+/=]/g
const BASE64URL_MAP: Record<string, string> = { '+': '-', '/': '_', '=': '' }

/** RFC 4648 §5 base64url, unpadded — the encoding every OAuth spec means. */
export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(BASE64URL_UNSAFE, (char) => BASE64URL_MAP[char] ?? '')
}

/** A URL-safe random token. 32 bytes for session ids and OAuth `state`. */
export function randomToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)))
}

/**
 * PKCE verifier: 43-128 chars from the unreserved set. base64url of 32 random
 * bytes gives 43, which is the minimum the RFC allows and plenty of entropy.
 */
export function createCodeVerifier(): string {
  return randomToken(32)
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)), unpadded. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(digest)
}

/** HTTP Basic credentials — VK authenticates the client this way. */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}
