import type { Rule, InterceptorRule, InterceptorPair } from '../shared/types'

const PAGE_LEVEL_TYPES = new Set(['modifyResponse', 'replaceInResponse', 'modifyRequestBody', 'delay'])
const DNR_TYPES = new Set(['redirect', 'block', 'modifyHeaders', 'modifyQueryParams', 'replace', 'userAgent'])

export function splitRules(rules: Rule[]): { dnrRules: Rule[]; pageRules: Rule[] } {
  const dnrRules: Rule[] = []
  const pageRules: Rule[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (PAGE_LEVEL_TYPES.has(rule.type)) pageRules.push(rule)
    else if (DNR_TYPES.has(rule.type)) dnrRules.push(rule)
    // insertScript handled separately
  }
  return { dnrRules, pageRules }
}

const OP_MAP: Record<string, InterceptorPair['source']['operator']> = {
  contains: 'Contains',
  equals: 'Equals',
  matches: 'Matches',
  wildcard: 'Wildcard_Matches',
}

function buildSource(rule: Rule): InterceptorPair['source'] {
  const cond = rule.condition
  const source: InterceptorPair['source'] = {
    key: 'Url',
    operator: OP_MAP[cond.urlOperator] ?? 'Contains',
    value: cond.urlValue,
  }
  const filters: InterceptorPair['source']['filters'] = []
  if (cond.methods?.length) filters.push({ requestMethod: cond.methods })
  if (cond.resourceTypes?.length) filters.push({ resourceType: cond.resourceTypes })
  if (filters.length) source.filters = filters
  return source
}

export function toInterceptorRules(rules: Rule[]): {
  requestRules: InterceptorRule[]
  responseRules: InterceptorRule[]
  delayRules: InterceptorRule[]
} {
  const requestRules: InterceptorRule[] = []
  const responseRules: InterceptorRule[] = []
  const delayRules: InterceptorRule[] = []

  for (const rule of rules) {
    const source = buildSource(rule)
    if (rule.action.type === 'modifyResponse') {
      responseRules.push({
        id: rule.id,
        ruleType: 'Response',
        pairs: [{
          source,
          response: {
            type: rule.action.bodyType === 'static' ? 'static' : 'code',
            value: rule.action.body,
            statusCode: rule.action.statusCode,
            serveWithoutRequest: rule.action.serveWithoutRequest ?? false,
          },
        }],
      })
    } else if (rule.action.type === 'replaceInResponse') {
      responseRules.push({
        id: rule.id,
        ruleType: 'Response',
        pairs: [{
          source,
          response: {
            type: 'replace',
            value: '',               // unused for replace type
            serveWithoutRequest: false,
            search: rule.action.search,
            replacement: rule.action.replacement,
            useRegex: rule.action.useRegex,
          },
        }],
      })
    } else if (rule.action.type === 'modifyRequestBody') {
      requestRules.push({
        id: rule.id,
        ruleType: 'Request',
        pairs: [{
          source,
          request: {
            type: rule.action.bodyType === 'static' ? 'static' : 'code',
            value: rule.action.body,
          },
        }],
      })
    } else if (rule.action.type === 'delay') {
      delayRules.push({
        id: rule.id,
        ruleType: 'Delay',
        pairs: [{ source, delay: rule.action.ms }],
      })
    }
  }

  return { requestRules, responseRules, delayRules }
}
