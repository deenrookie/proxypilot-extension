import { describe, it, expect } from 'vitest'
import { compileToDNR } from '../../src/background/dnr-compiler'
import type { Rule } from '../../src/shared/types'

function baseRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'test-1',
    name: 'Test',
    type: 'redirect',
    enabled: true,
    condition: { urlOperator: 'contains', urlValue: 'api.example.com' },
    action: { type: 'redirect', redirectUrl: 'https://mock.example.com' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('compileToDNR', () => {
  it('skips disabled rules', () => {
    const rule = baseRule({ enabled: false })
    expect(compileToDNR([rule])).toHaveLength(0)
  })

  it('compiles redirect rule', () => {
    const rules = compileToDNR([baseRule()])
    expect(rules).toHaveLength(1)
    expect(rules[0].action.type).toBe('redirect')
    expect((rules[0].action as any).redirect.url).toBe('https://mock.example.com')
    expect(rules[0].condition.urlFilter).toBe('api.example.com')
  })

  it('compiles block rule', () => {
    const rule = baseRule({ type: 'block', action: { type: 'block' } })
    const rules = compileToDNR([rule])
    expect(rules[0].action.type).toBe('block')
  })

  it('compiles modifyHeaders rule', () => {
    const rule = baseRule({
      type: 'modifyHeaders',
      action: {
        type: 'modifyHeaders',
        request: [{ op: 'set', header: 'x-custom', value: 'test' }],
        response: [{ op: 'remove', header: 'x-frame-options' }],
      },
    })
    const rules = compileToDNR([rule])
    expect(rules[0].action.type).toBe('modifyHeaders')
    const a = rules[0].action as any
    expect(a.requestHeaders).toHaveLength(1)
    expect(a.requestHeaders[0].header).toBe('x-custom')
    expect(a.responseHeaders[0].operation).toBe('remove')
  })

  it('compiles equals operator as exact filter', () => {
    const rule = baseRule({
      condition: { urlOperator: 'equals', urlValue: 'https://api.example.com/users' },
    })
    const rules = compileToDNR([rule])
    expect(rules[0].condition.urlFilter).toBe('|https://api.example.com/users|')
  })

  it('compiles regex operator using regexFilter', () => {
    const rule = baseRule({
      condition: { urlOperator: 'matches', urlValue: '/api\\/v\\d+/' },
    })
    const rules = compileToDNR([rule])
    expect(rules[0].condition.regexFilter).toBeTruthy()
  })

  it('assigns unique IDs to multiple rules', () => {
    const rules = compileToDNR([baseRule({ id: 'a' }), baseRule({ id: 'b', name: 'B' })])
    expect(rules[0].id).not.toBe(rules[1].id)
  })

  it('compiles userAgent rule as modifyHeaders', () => {
    const rule = baseRule({
      type: 'userAgent',
      action: { type: 'userAgent', ua: 'CustomUA/1.0' },
    })
    const rules = compileToDNR([rule])
    expect(rules[0].action.type).toBe('modifyHeaders')
    const a = rules[0].action as any
    expect(a.requestHeaders[0].header).toBe('user-agent')
    expect(a.requestHeaders[0].value).toBe('CustomUA/1.0')
  })

  it('applies resource type filter', () => {
    const rule = baseRule({
      condition: { urlOperator: 'contains', urlValue: 'api', resourceTypes: ['xmlhttprequest'] },
    })
    const rules = compileToDNR([rule])
    expect(rules[0].condition.resourceTypes).toContain('xmlhttprequest')
  })
})
