import { describe, it, expect } from 'vitest'
import { matchUrl, matchCondition } from '../../src/shared/matcher'
import type { MatchCondition } from '../../src/shared/types'

describe('matchUrl', () => {
  describe('contains', () => {
    it('matches substring', () => {
      expect(matchUrl({ urlOperator: 'contains', urlValue: 'api.example.com' }, 'https://api.example.com/users')).toBe(true)
    })
    it('does not match missing substring', () => {
      expect(matchUrl({ urlOperator: 'contains', urlValue: 'other.com' }, 'https://api.example.com/users')).toBe(false)
    })
    it('matches partial path', () => {
      expect(matchUrl({ urlOperator: 'contains', urlValue: '/v2/' }, 'https://api.example.com/v2/users')).toBe(true)
    })
  })

  describe('equals', () => {
    it('matches exact URL', () => {
      const url = 'https://api.example.com/users'
      expect(matchUrl({ urlOperator: 'equals', urlValue: url }, url)).toBe(true)
    })
    it('does not match different URL', () => {
      expect(matchUrl({ urlOperator: 'equals', urlValue: 'https://api.example.com' }, 'https://api.example.com/users')).toBe(false)
    })
  })

  describe('matches (regex)', () => {
    it('matches regex pattern with slashes', () => {
      expect(matchUrl({ urlOperator: 'matches', urlValue: '/api\\/v\\d+\\//' }, 'https://example.com/api/v2/users')).toBe(true)
    })
    it('matches plain regex without slashes', () => {
      expect(matchUrl({ urlOperator: 'matches', urlValue: 'api\\/v\\d+' }, 'https://example.com/api/v2/users')).toBe(true)
    })
    it('does not match non-matching regex', () => {
      expect(matchUrl({ urlOperator: 'matches', urlValue: '^https://other' }, 'https://api.example.com')).toBe(false)
    })
    it('handles case-insensitive flag', () => {
      expect(matchUrl({ urlOperator: 'matches', urlValue: '/EXAMPLE/i' }, 'https://api.example.com')).toBe(true)
    })
  })

  describe('wildcard', () => {
    it('matches with * wildcard', () => {
      expect(matchUrl({ urlOperator: 'wildcard', urlValue: 'https://api.*.com/*' }, 'https://api.example.com/users')).toBe(true)
    })
    it('matches trailing *', () => {
      expect(matchUrl({ urlOperator: 'wildcard', urlValue: 'https://api.example.com/*' }, 'https://api.example.com/users/123')).toBe(true)
    })
    it('does not match different domain', () => {
      expect(matchUrl({ urlOperator: 'wildcard', urlValue: 'https://api.example.com/*' }, 'https://api.other.com/users')).toBe(false)
    })
  })
})

describe('matchCondition', () => {
  const base: MatchCondition = { urlOperator: 'contains', urlValue: 'api.example.com' }

  it('passes when no method filter', () => {
    expect(matchCondition(base, 'https://api.example.com', 'GET')).toBe(true)
  })

  it('filters by method', () => {
    const cond: MatchCondition = { ...base, methods: ['POST'] }
    expect(matchCondition(cond, 'https://api.example.com', 'GET')).toBe(false)
    expect(matchCondition(cond, 'https://api.example.com', 'POST')).toBe(true)
  })

  it('is case-insensitive for method', () => {
    const cond: MatchCondition = { ...base, methods: ['GET'] }
    expect(matchCondition(cond, 'https://api.example.com', 'get')).toBe(true)
  })

  it('filters by resource type', () => {
    const cond: MatchCondition = { ...base, resourceTypes: ['xmlhttprequest'] }
    expect(matchCondition(cond, 'https://api.example.com', 'GET', 'script')).toBe(false)
    expect(matchCondition(cond, 'https://api.example.com', 'GET', 'xmlhttprequest')).toBe(true)
  })

  it('returns false when URL does not match even if method matches', () => {
    const cond: MatchCondition = { ...base, methods: ['GET'] }
    expect(matchCondition(cond, 'https://other.com/api', 'GET')).toBe(false)
  })
})
