/**
 * Why a request to the Claude API never got an answer. The SDK wraps every
 * network failure as one "Connection error", with the real reason a few
 * causes down (fetch failed → the socket's error and its code), so this digs
 * it out and says it in words a teacher can act on.
 */
import Anthropic from '@anthropic-ai/sdk'

type Cause = { code?: string; message: string }

/** The error and each cause under it, outermost first. */
export function causeChain(err: unknown): Cause[] {
  const out: Cause[] = []
  let c: unknown = err
  for (let i = 0; c && i < 8; i++) {
    const e = c as { code?: unknown; message?: unknown; cause?: unknown }
    out.push({ code: typeof e.code === 'string' ? e.code : undefined, message: typeof e.message === 'string' ? e.message : String(c) })
    c = e.cause
  }
  return out
}

const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/
const LOOKUP = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const BLOCKED = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'])

/** A sentence for a connection error from the SDK; the code at the end is for whoever helps. */
export function connectionMessage(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude took too long to answer, three times over. Try again; if it keeps happening, analyse fewer packets at once.'
  const chain = causeChain(err)
  const code = chain.map((c) => c.code).filter(Boolean).pop()
  if (code && CERT.test(code)) return `A school firewall or antivirus on this computer is checking secure connections, and the app does not trust its certificate (${code}). Installing the current Node.js LTS from nodejs.org usually fixes this; if not, ask IT to let this computer reach api.anthropic.com.`
  if (code && LOOKUP.has(code)) return `This computer could not look up api.anthropic.com (${code}): it is offline, or the network blocks that site.`
  if (code && BLOCKED.has(code)) return `The network blocked or dropped the connection to api.anthropic.com (${code}). A school firewall may be blocking it; ask IT to allow api.anthropic.com.`
  const deepest = chain[chain.length - 1]
  return `Could not reach the Claude API: ${deepest?.message ?? 'connection error'}${code ? ` (${code})` : ''}.`
}

/** A pasted key without the quotes, spaces, line breaks or "ANTHROPIC_API_KEY=" that came with it. */
export function cleanKey(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^ANTHROPIC_API_KEY=/i, '').replace(/^["']+|["']+$/g, '')
}

/** Why Anthropic turned the saved key away, with only its ends shown. */
export function authMessage(key: string | null): string {
  const k = key ?? ''
  if (k.startsWith('sk-ant-admin')) return 'The key in Settings is an admin key, which cannot analyse work. Make an ordinary API key at console.anthropic.com (Settings → API keys) and paste that.'
  if (k.startsWith('sk-ant-') && !k.startsWith('sk-ant-api')) return 'The key in Settings is not an API key (API keys start with sk-ant-api). Make one at console.anthropic.com (Settings → API keys) and paste it in Settings.'
  if (!k.startsWith('sk-ant-api')) return 'The key in Settings does not look like an Anthropic API key: those start with sk-ant-api. Copy it again from console.anthropic.com (Settings → API keys).'
  return `Anthropic rejected the API key ${k.slice(0, 10)}…${k.slice(-4)}: it was deleted, or only part of it was copied. Find a key ending in ${k.slice(-4)} at console.anthropic.com (Settings → API keys); if there is none, make a new key and paste it in Settings.`
}
