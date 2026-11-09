import type { Response } from 'express'
import type { FeedEvent } from '../shared/types.js'

// Server-sent events: the Today page listens here so pages appear as they scan.
const clients = new Set<Response>()

export function subscribe(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  clients.add(res)
  send(res, { type: 'hello', at: new Date().toISOString(), payload: null })
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)
  res.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
}

function send(res: Response, ev: FeedEvent) {
  res.write(`data: ${JSON.stringify(ev)}\n\n`)
}

export function broadcast(type: FeedEvent['type'], payload: unknown) {
  const ev: FeedEvent = { type, at: new Date().toISOString(), payload }
  for (const c of clients) send(c, ev)
}
