/**
 * Trust the certificates the operating system trusts, as well as Node's own.
 * School networks and antivirus (AhnLab V3, for one) check secure connections
 * by re-signing them with their own certificate, which Windows and the browser
 * trust but Node, with its own list, does not: every call to Claude then fails
 * with SELF_SIGNED_CERT_IN_CHAIN. Node versions without these functions are
 * left as they are (Start Scanner.cmd also sets NODE_USE_SYSTEM_CA for them).
 */
import tls from 'node:tls'

type TlsWithCA = typeof tls & {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[]
  setDefaultCACertificates?: (certs: string[]) => void
}

/** How many system certificates were added, or null when this Node cannot. */
export function trustSystemCertificates(): number | null {
  const t = tls as TlsWithCA
  if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return null
  try {
    const current = t.getCACertificates('default')
    const have = new Set(current)
    const added = t.getCACertificates('system').filter((c) => !have.has(c))
    if (added.length) t.setDefaultCACertificates([...current, ...added])
    return added.length
  } catch {
    return null
  }
}
