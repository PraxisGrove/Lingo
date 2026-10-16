import type { ProviderKind, ProviderModel } from '../storage/settings-model';

export type ModelProtocol = Extract<
  ProviderKind,
  'openai-compatible' | 'openai-responses' | 'anthropic'
>;

const ENDPOINT_PROTOCOLS: Array<[RegExp, ModelProtocol]> = [
  [/\/chat\/completions\/?$/, 'openai-compatible'],
  [/\/responses\/?$/, 'openai-responses'],
  [/\/messages\/?$/, 'anthropic'],
];

/**
 * Local gateways such as Magpie list `native_endpoints` per model because one
 * address can route models that only accept a single protocol.
 */
export function protocolsFromEndpoints(
  value: unknown,
): ModelProtocol[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const protocols = new Set<ModelProtocol>();
  for (const endpoint of value) {
    if (typeof endpoint !== 'string') continue;
    for (const [pattern, protocol] of ENDPOINT_PROTOCOLS)
      if (pattern.test(endpoint)) protocols.add(protocol);
  }
  return protocols.size > 0 ? [...protocols] : undefined;
}

/**
 * The protocol to use for a model: keep the current one when the model
 * supports it, otherwise prefer Chat Completions, then Responses, then
 * Anthropic Messages.
 */
export function protocolForModel(
  model: Pick<ProviderModel, 'protocols'> | undefined,
  current: ProviderKind,
): ProviderKind {
  const supported = model?.protocols;
  if (!supported?.length || supported.includes(current as ModelProtocol))
    return current;
  return (
    (['openai-compatible', 'openai-responses', 'anthropic'] as const).find(
      (protocol) => supported.includes(protocol),
    ) ?? current
  );
}
