import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { authMessage, causeChain, cleanKey, connectionMessage } from '../server/netErrors.js'

// What the SDK throws when fetch fails: APIConnectionError → TypeError('fetch failed') → the socket's error.
function failed(code: string, message = code) {
  const sock = Object.assign(new Error(message), { code })
  const fetchErr = new TypeError('fetch failed', { cause: sock })
  return new Anthropic.APIConnectionError({ cause: fetchErr })
}

describe('connection errors say what actually went wrong', () => {
  it('walks the cause chain down to the socket error', () => {
    expect(causeChain(failed('ENOTFOUND', 'getaddrinfo ENOTFOUND api.anthropic.com')).map((c) => c.code ?? null)).toEqual([null, null, 'ENOTFOUND'])
  })

  it('names a certificate a firewall or antivirus put in the way', () => {
    for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED']) {
      const m = connectionMessage(failed(code))
      expect(m).toMatch(/antivirus|firewall/i)
      expect(m).toContain(code)
    }
  })

  it('says when the name could not be looked up', () => {
    const m = connectionMessage(failed('ENOTFOUND', 'getaddrinfo ENOTFOUND api.anthropic.com'))
    expect(m).toMatch(/look up api\.anthropic\.com/)
    expect(m).toContain('ENOTFOUND')
  })

  it('says when the network refused or dropped the connection', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']) {
      const m = connectionMessage(failed(code))
      expect(m).toMatch(/blocked|dropped/)
      expect(m).toContain(code)
    }
  })

  it('tells a timeout apart from a connection that never opened', () => {
    expect(connectionMessage(new Anthropic.APIConnectionTimeoutError())).toMatch(/too long/)
  })

  it('falls back to the deepest message it has', () => {
    const m = connectionMessage(new Anthropic.APIConnectionError({ cause: new TypeError('fetch failed', { cause: new Error('something odd') }) }))
    expect(m).toContain('something odd')
  })
})

describe('a rejected API key', () => {
  it('cleans what was pasted around a key', () => {
    expect(cleanKey('  "sk-ant-api03-abc\n def"  ')).toBe('sk-ant-api03-abcdef')
    expect(cleanKey("'sk-ant-api03-abc'")).toBe('sk-ant-api03-abc')
    expect(cleanKey('ANTHROPIC_API_KEY=sk-ant-api03-abc')).toBe('sk-ant-api03-abc')
    expect(cleanKey('')).toBe('')
  })

  it('says when what was saved is not an API key at all', () => {
    expect(authMessage('sk-ant-admin01-xyz')).toMatch(/admin key/)
    expect(authMessage('sk-ant-oat01-xyz')).toMatch(/not an API key/)
    expect(authMessage('hello')).toMatch(/start with sk-ant-api/)
  })

  it('shows the ends of a real-looking key so it can be matched in the Console', () => {
    const m = authMessage('sk-ant-api03-ABCDEFGHIJKLMNOP-wxyz')
    expect(m).toContain('sk-ant-api…wxyz')
    expect(m).toMatch(/console\.anthropic\.com/)
    expect(m).not.toContain('ABCDEFGHIJ')
  })
})
