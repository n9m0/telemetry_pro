import { describe, expect, it } from 'vitest'
import { isAllowedHost, isAllowedOrigin, isAllowedProxyRoute } from './request-guard.js'

const ports = new Set([4174, 5175])

describe('request guard', () => {
  it('accepts only loopback Host headers on known ports (DNS rebinding)', () => {
    expect(isAllowedHost('127.0.0.1:4174', ports)).toBe(true)
    expect(isAllowedHost('localhost:5175', ports)).toBe(true)
    expect(isAllowedHost('[::1]:4174', ports)).toBe(true)
    expect(isAllowedHost('attacker.example:4174', ports)).toBe(false)
    expect(isAllowedHost('127.0.0.1.attacker.example:4174', ports)).toBe(false)
    expect(isAllowedHost('127.0.0.1:9999', ports)).toBe(false)
    expect(isAllowedHost(undefined, ports)).toBe(false)
  })

  it('rejects foreign or opaque Origin headers but allows requests without one', () => {
    expect(isAllowedOrigin(undefined, ports)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5175', ports)).toBe(true)
    expect(isAllowedOrigin('https://evil.example', ports)).toBe(false)
    expect(isAllowedOrigin('http://localhost:3000', ports)).toBe(false)
    expect(isAllowedOrigin('null', ports)).toBe(false)
  })

  it('proxies only read and inference routes with exact paths', () => {
    expect(isAllowedProxyRoute('POST', '/api/chat')).toBe(true)
    expect(isAllowedProxyRoute('GET', '/api/tags?x=1')).toBe(true)
    for (const [method, path] of [['POST', '/api/pull'], ['DELETE', '/api/delete'], ['POST', '/api/create'], ['GET', '/api/generate'], ['GET', '/api/tags/../delete']]) {
      expect(isAllowedProxyRoute(method, path)).toBe(false)
    }
  })
})
