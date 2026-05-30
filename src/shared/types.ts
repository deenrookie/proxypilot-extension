export type RuleType =
  | 'redirect'
  | 'block'
  | 'modifyHeaders'
  | 'modifyResponse'
  | 'replaceInResponse'
  | 'insertScript'
  | 'modifyQueryParams'
  | 'modifyRequestBody'
  | 'replace'
  | 'delay'
  | 'userAgent'

export type UrlOperator = 'contains' | 'equals' | 'matches' | 'wildcard'

export interface MatchCondition {
  urlOperator: UrlOperator
  urlValue: string
  resourceTypes?: string[]
  methods?: string[]
}

export interface HeaderOp {
  op: 'set' | 'remove' | 'append'
  header: string
  value?: string
}

export type RuleAction =
  | { type: 'redirect'; redirectUrl: string }
  | { type: 'block' }
  | { type: 'modifyHeaders'; request?: HeaderOp[]; response?: HeaderOp[] }
  | { type: 'modifyResponse'; statusCode?: number; body: string; bodyType: 'static' | 'jsFunction'; serveWithoutRequest?: boolean }
  | { type: 'replaceInResponse'; search: string; replacement: string; useRegex: boolean }
  | { type: 'insertScript'; code: string; lang: 'js' | 'css'; runAt: 'document_start' | 'document_end' }
  | { type: 'modifyQueryParams'; add?: Record<string, string>; remove?: string[] }
  | { type: 'modifyRequestBody'; body: string; bodyType: 'static' | 'jsFunction' }
  | { type: 'replace'; from: string; to: string }
  | { type: 'delay'; ms: number }
  | { type: 'userAgent'; ua: string }

export interface Rule {
  id: string
  name: string
  type: RuleType
  enabled: boolean
  condition: MatchCondition
  action: RuleAction
  createdAt: number
  updatedAt: number
}

export interface GlobalState {
  masterEnabled: boolean
  rules: Rule[]
}

// Legacy Requestly-compatible rule format used by interceptor.js internally
export interface InterceptorRule {
  id: string
  ruleType: string
  pairs: InterceptorPair[]
}

export interface InterceptorPair {
  source: {
    key: 'Url' | 'host' | 'path'
    operator: 'Equals' | 'Contains' | 'Matches' | 'Wildcard_Matches'
    value: string
    filters?: Array<{ requestMethod?: string[]; resourceType?: string[] }>
  }
  response?: {
    type: 'static' | 'code' | 'replace'
    value: string
    statusCode?: number
    statusText?: string
    serveWithoutRequest?: boolean
    // used when type === 'replace'
    search?: string
    replacement?: string
    useRegex?: boolean
  }
  request?: {
    type: 'static' | 'code'
    value: string
  }
  delay?: number
}
