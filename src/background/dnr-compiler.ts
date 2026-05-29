import type { Rule, MatchCondition } from '../shared/types'

type DNRRule = chrome.declarativeNetRequest.Rule

let _nextId = 1

function freshId(): number {
  return _nextId++
}

function buildCondition(cond: MatchCondition): chrome.declarativeNetRequest.RuleCondition {
  const condition: chrome.declarativeNetRequest.RuleCondition = {}

  switch (cond.urlOperator) {
    case 'equals':
      condition.urlFilter = `|${cond.urlValue}|`
      break
    case 'contains':
      condition.urlFilter = cond.urlValue
      break
    case 'matches':
      // Strip wrapping slashes/flags for DNR regexFilter
      condition.regexFilter = cond.urlValue.replace(/^\/|\/[gi]*$/g, '')
      break
    case 'wildcard':
      condition.urlFilter = cond.urlValue
      break
  }

  if (cond.resourceTypes?.length) {
    condition.resourceTypes = cond.resourceTypes as chrome.declarativeNetRequest.ResourceType[]
  }
  if (cond.methods?.length) {
    condition.requestMethods = cond.methods.map((m) =>
      m.toLowerCase()
    ) as chrome.declarativeNetRequest.RequestMethod[]
  }

  return condition
}

export function compileToDNR(rules: Rule[]): DNRRule[] {
  _nextId = 1
  const dnrRules: DNRRule[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    const condition = buildCondition(rule.condition)

    switch (rule.action.type) {
      case 'redirect':
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: { url: rule.action.redirectUrl },
          },
          condition,
        })
        break

      case 'block':
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType.BLOCK },
          condition,
        })
        break

      case 'modifyHeaders': {
        const reqHeaders = rule.action.request?.map((op) => ({
          header: op.header,
          operation: op.op as chrome.declarativeNetRequest.HeaderOperation,
          value: op.value,
        }))
        const resHeaders = rule.action.response?.map((op) => ({
          header: op.header,
          operation: op.op as chrome.declarativeNetRequest.HeaderOperation,
          value: op.value,
        }))
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: reqHeaders,
            responseHeaders: resHeaders,
          },
          condition,
        })
        break
      }

      case 'modifyQueryParams': {
        const queryTransform: chrome.declarativeNetRequest.QueryTransform = {}
        if (rule.action.add) {
          queryTransform.addOrReplaceParams = Object.entries(rule.action.add).map(([key, value]) => ({ key, value }))
        }
        if (rule.action.remove?.length) {
          queryTransform.removeParams = rule.action.remove
        }
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: { transform: { queryTransform } },
          },
          condition,
        })
        break
      }

      case 'replace': {
        const escaped = rule.action.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType.REDIRECT,
            redirect: { regexSubstitution: rule.action.to },
          },
          condition: { ...condition, regexFilter: `(.*)(${escaped})(.*)` },
        })
        break
      }

      case 'userAgent':
        dnrRules.push({
          id: freshId(),
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [{ header: 'user-agent', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: rule.action.ua }],
          },
          condition,
        })
        break
    }
  }

  return dnrRules
}
