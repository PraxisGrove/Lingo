import type { ProviderModel } from '../storage/settings-model';

export type ProviderModelSelection = 'recommended' | 'manual';

/** Resolve a concrete model only when importing or refreshing the catalog. */
export function selectTranslationModel(
  models: readonly ProviderModel[],
  options: {
    mode: ProviderModelSelection;
    currentModel?: string;
    preferredModel?: string;
  },
): string | undefined {
  if (options.mode === 'manual')
    return options.currentModel?.trim() || undefined;
  if (models.some((model) => model.id === options.preferredModel)) {
    return options.preferredModel;
  }
  return [...models].sort(
    (left, right) =>
      modelScore(right.id) - modelScore(left.id) ||
      left.id.localeCompare(right.id, 'en'),
  )[0]?.id;
}

// A conservative convenience default, not a quality or pricing benchmark.
function modelScore(id: string): number {
  const name = id.toLowerCase();
  let score = 0;
  if (
    /(?:mini|flash|haiku|turbo|instant|small|lite|air)(?:[-.:/]|$)/.test(name)
  )
    score += 8;
  if (
    /(?:chat|instruct|qwen|gemini|claude|gpt|deepseek|kimi|glm|mistral)/.test(
      name,
    )
  )
    score += 3;
  if (
    /(?:preview|experimental|exp-|thinking|reasoner|coder|code|opus|max|large|pro)(?:[-.:/]|$)/.test(
      name,
    )
  )
    score -= 5;
  const size = name.match(/(?:^|[-/])(\d+(?:\.\d+)?)b(?:[-.:/]|$)/);
  if (size) score += Number(size[1]) <= 32 ? 2 : -2;
  return score;
}
