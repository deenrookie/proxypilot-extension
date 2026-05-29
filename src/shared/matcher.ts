import type { MatchCondition, Rule } from './types'

export function matchUrl(condition: MatchCondition, url: string): boolean {
  const { urlOperator, urlValue } = condition
  switch (urlOperator) {
    case 'contains':
      return url.includes(urlValue)
    case 'equals':
      return url === urlValue
    case 'matches':
      return testRegex(urlValue, url)
    case 'wildcard':
      return testWildcard(urlValue, url)
    default:
      return false
  }
}

function testRegex(pattern: string, target: string): boolean {
  try {
    const m = pattern.match(/^\/(.+)\/(i|g|gi|ig)?$/)
    const re = m ? new RegExp(m[1], m[2] || '') : new RegExp(pattern)
    return re.test(target)
  } catch {
    return false
  }
}

function testWildcard(pattern: string, target: string): boolean {
  // Convert * to .* and escape other regex metacharacters
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return testRegex(`^${regexStr}$`, target)
}

export function matchCondition(condition: MatchCondition, url: string, method?: string, resourceType?: string): boolean {
  if (!matchUrl(condition, url)) return false
  if (condition.methods?.length && method && !condition.methods.includes(method.toUpperCase())) return false
  if (condition.resourceTypes?.length && resourceType && !condition.resourceTypes.includes(resourceType)) return false
  return true
}

export function findMatchingRule(rules: Rule[], url: string, method?: string, resourceType?: string): Rule | undefined {
  return [...rules].reverse().find(
    (rule: Rule) => rule.enabled && matchCondition(rule.condition, url, method, resourceType)
  )
}

export function findMatchingRules(rules: Rule[], url: string, method?: string, resourceType?: string): Rule[] {
  return rules.filter(
    (rule) => rule.enabled && matchCondition(rule.condition, url, method, resourceType)
  )
}
