import type { NextFunction, Request, Response } from 'express'

const loopbackAuthority = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i

const proxyRoutes: Record<string, ReadonlySet<string>> = {
  GET: new Set(['/api/tags', '/api/ps', '/api/version']),
  POST: new Set(['/api/generate', '/api/chat', '/api/show', '/api/embed', '/api/embeddings']),
}

function allowedAuthority(authority: string | undefined, ports: ReadonlySet<number>): boolean {
  const match = authority?.match(loopbackAuthority)
  if (!match) return false
  return ports.has(match[2] ? Number(match[2]) : 80)
}

export function isAllowedHost(host: string | undefined, ports: ReadonlySet<number>): boolean {
  return allowedAuthority(host, ports)
}

export function isAllowedOrigin(origin: string | undefined, ports: ReadonlySet<number>): boolean {
  if (origin === undefined) return true
  return origin.startsWith('http://') && allowedAuthority(origin.slice('http://'.length), ports)
}

// Exact matching on the raw path keeps dot-segment and encoded variants (e.g. /api/tags/../delete) out.
export function isAllowedProxyRoute(method: string, path: string): boolean {
  return proxyRoutes[method]?.has(path.split('?')[0]) ?? false
}

// Blocks DNS rebinding (foreign Host header) and requests from other browser origins.
export function requestGuard(ports: ReadonlySet<number>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!isAllowedHost(request.headers.host, ports) || !isAllowedOrigin(request.headers.origin, ports)) {
      response.status(403).json({ error: 'Request rejected: only local access to the monitor is permitted.' })
      return
    }
    next()
  }
}
