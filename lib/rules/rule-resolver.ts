import type {
  SiteTranslationPolicy,
  SourceLanguagePolicy,
} from '@/lib/preferences/preference-resolver';

export type RuleSelectors = {
  main?: string[];
  interface?: string[];
  exclude?: string[];
};

export type SiteRule = {
  id: string;
  domain: string;
  selectors?: RuleSelectors;
  translationPolicy?: SiteTranslationPolicy;
  sourceLanguagePolicy?: SourceLanguagePolicy;
};

export type RuleSet = {
  schemaVersion: 1;
  rules: SiteRule[];
};

export type CommunityRulePackage = {
  payload: RuleSet;
  signature: string;
};

export type ResolvedRule = {
  matchedRuleIds: string[];
  selectors: RuleSelectors;
  translationPolicy?: SiteTranslationPolicy;
  sourceLanguagePolicy?: SourceLanguagePolicy;
};

type RuleResolutionInput = {
  hostname: string;
  builtIn?: RuleSet;
  community?: RuleSet;
  user?: RuleSet;
};

export const BUILT_IN_RULES: RuleSet = {
  schemaVersion: 1,
  rules: [
    {
      id: 'default-wikipedia',
      domain: '*.wikipedia.org',
      translationPolicy: 'default',
      selectors: { main: ['main', '#bodyContent'], exclude: ['.navbox'] },
    },
    {
      id: 'default-mdn',
      domain: 'developer.mozilla.org',
      translationPolicy: 'default',
      selectors: { main: ['main'], exclude: ['pre', 'code'] },
    },
  ],
};

export function validateRuleSet(value: unknown): RuleSet {
  const source = record(value, 'rule set');
  requireKeys(source, ['schemaVersion', 'rules'], 'rule set');
  if (source.schemaVersion !== 1) throw new Error('unsupported rule schema');
  if (!Array.isArray(source.rules)) throw new Error('rules must be an array');
  return {
    schemaVersion: 1,
    rules: source.rules.map(validateRule),
  };
}

export function resolveRules(input: RuleResolutionInput): ResolvedRule {
  const result: ResolvedRule = { matchedRuleIds: [], selectors: {} };
  for (const rules of [input.builtIn, input.community, input.user]) {
    if (!rules) continue;
    for (const rule of matchingRules(validateRuleSet(rules), input.hostname)) {
      result.matchedRuleIds.push(rule.id);
      result.selectors = mergeSelectors(result.selectors, rule.selectors);
      if (rule.translationPolicy !== undefined) {
        result.translationPolicy = rule.translationPolicy;
      }
      if (rule.sourceLanguagePolicy !== undefined) {
        result.sourceLanguagePolicy = rule.sourceLanguagePolicy;
      }
    }
  }
  return result;
}

export function exportUserRules(rules: RuleSet): string {
  return JSON.stringify(validateRuleSet(rules));
}

export function importUserRules(serialized: string): RuleSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('rules must be valid JSON');
  }
  return validateRuleSet(parsed);
}

export function serializeCommunityRulePayload(payload: RuleSet): string {
  return canonicalJson(validateRuleSet(payload));
}

export type CommunityRuleState = {
  updatesEnabled: boolean;
  lastKnownGood?: RuleSet;
};

type CommunityRuleStateStore = {
  getValue(): Promise<CommunityRuleState>;
  setValue(value: CommunityRuleState): Promise<void>;
};

export function createCommunityRuleStore(store: CommunityRuleStateStore) {
  return {
    async get(): Promise<CommunityRuleState> {
      const state = await store.getValue();
      return {
        updatesEnabled: state.updatesEnabled !== false,
        ...(state.lastKnownGood
          ? { lastKnownGood: validateRuleSet(state.lastKnownGood) }
          : {}),
      };
    },
    async setUpdatesEnabled(updatesEnabled: boolean): Promise<void> {
      await store.setValue({ ...(await this.get()), updatesEnabled });
    },
    async applyUpdate(
      candidate: CommunityRulePackage,
      publicKey: CryptoKey,
    ): Promise<
      | { status: 'updated'; rules: RuleSet }
      | { status: 'rejected' | 'disabled'; rules?: RuleSet }
    > {
      const state = await this.get();
      if (!state.updatesEnabled) {
        return {
          status: 'disabled',
          ...(state.lastKnownGood ? { rules: state.lastKnownGood } : {}),
        };
      }
      try {
        const rules = validateRuleSet(candidate.payload);
        const signature = base64ToBytes(candidate.signature);
        const valid = await crypto.subtle.verify(
          'Ed25519',
          publicKey,
          signature,
          new TextEncoder().encode(serializeCommunityRulePayload(rules)),
        );
        if (!valid) throw new Error('invalid community rule signature');
        await store.setValue({ ...state, lastKnownGood: rules });
        return { status: 'updated', rules };
      } catch {
        return {
          status: 'rejected',
          ...(state.lastKnownGood ? { rules: state.lastKnownGood } : {}),
        };
      }
    },
  };
}

function validateRule(value: unknown): SiteRule {
  const source = record(value, 'rule');
  requireKeys(
    source,
    ['id', 'domain', 'selectors', 'translationPolicy', 'sourceLanguagePolicy'],
    'rule',
    ['id', 'domain'],
  );
  if (
    typeof source.id !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(source.id)
  ) {
    throw new Error('invalid rule id');
  }
  if (typeof source.domain !== 'string' || !validDomain(source.domain)) {
    throw new Error('invalid rule domain');
  }
  return {
    id: source.id,
    domain: source.domain.toLowerCase(),
    ...(source.selectors === undefined
      ? {}
      : { selectors: validateSelectors(source.selectors) }),
    ...(source.translationPolicy === undefined
      ? {}
      : {
          translationPolicy: validateTranslationPolicy(
            source.translationPolicy,
          ),
        }),
    ...(source.sourceLanguagePolicy === undefined
      ? {}
      : {
          sourceLanguagePolicy: validateSourceLanguagePolicy(
            source.sourceLanguagePolicy,
          ),
        }),
  };
}

function validateSelectors(value: unknown): RuleSelectors {
  const source = record(value, 'selectors');
  requireKeys(source, ['main', 'interface', 'exclude'], 'selectors');
  const selectors: RuleSelectors = {};
  for (const key of ['main', 'interface', 'exclude'] as const) {
    if (source[key] === undefined) continue;
    if (
      !Array.isArray(source[key]) ||
      source[key].some(
        (item) => typeof item !== 'string' || !safeSelector(item),
      )
    ) {
      throw new Error('unsafe selector');
    }
    selectors[key] = [...source[key]];
  }
  return selectors;
}

function validateTranslationPolicy(value: unknown): SiteTranslationPolicy {
  if (value === 'default' || value === 'always' || value === 'never')
    return value;
  throw new Error('invalid translation policy');
}

function validateSourceLanguagePolicy(value: unknown): SourceLanguagePolicy {
  const source = record(value, 'source language policy');
  requireKeys(source, ['mode', 'languages'], 'source language policy');
  if (
    (source.mode !== 'all' &&
      source.mode !== 'included' &&
      source.mode !== 'excluded') ||
    !Array.isArray(source.languages) ||
    source.languages.some(
      (language) =>
        typeof language !== 'string' ||
        !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language),
    )
  ) {
    throw new Error('invalid source language policy');
  }
  return { mode: source.mode, languages: [...source.languages] };
}

function matchingRules(rules: RuleSet, hostname: string): SiteRule[] {
  return rules.rules
    .filter((rule) => matchesDomain(rule.domain, hostname))
    .sort(
      (left, right) =>
        domainSpecificity(left.domain) - domainSpecificity(right.domain),
    );
}

function matchesDomain(pattern: string, hostname: string): boolean {
  const domain = hostname.toLowerCase();
  return pattern.startsWith('*.')
    ? domain.endsWith(pattern.slice(1)) && domain !== pattern.slice(2)
    : domain === pattern;
}

function mergeSelectors(
  base: RuleSelectors,
  next?: RuleSelectors,
): RuleSelectors {
  return { ...base, ...next };
}

function domainSpecificity(pattern: string): number {
  return pattern.replace('*', '').length;
}

function validDomain(value: string): boolean {
  return /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    value,
  );
}

function safeSelector(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[;{}@]/.test(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireKeys(
  source: Record<string, unknown>,
  allowed: string[],
  label: string,
  required: string[] = [],
) {
  if (Object.keys(source).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains an unknown field`);
  }
  if (required.some((key) => !(key in source))) {
    throw new Error(`${label} is missing a required field`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function base64ToBytes(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('invalid base64 signature');
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
