import { describe, expect, it } from 'vitest';
import { selectTranslationModel } from './model-selection';

const models = ['gpt-large', 'gpt-mini', 'text-chat'].map((id) => ({
  id,
  name: id,
}));

describe('model selection after catalog discovery', () => {
  it('uses the service default only when that model appears in its catalog', () => {
    expect(
      selectTranslationModel(models, {
        mode: 'recommended',
        preferredModel: 'text-chat',
      }),
    ).toBe('text-chat');
    expect(
      selectTranslationModel(models, {
        mode: 'recommended',
        preferredModel: 'retired-model',
      }),
    ).toBe('gpt-mini');
  });

  it('preserves manual selections across refreshes, including private deployment ids', () => {
    expect(
      selectTranslationModel(models, {
        mode: 'manual',
        currentModel: ' private-deployment ',
        preferredModel: 'gpt-mini',
      }),
    ).toBe('private-deployment');
    expect(
      selectTranslationModel([], {
        mode: 'manual',
        currentModel: 'private-deployment',
      }),
    ).toBe('private-deployment');
    expect(selectTranslationModel(models, { mode: 'manual' })).toBeUndefined();
  });

  it('chooses a lightweight general model without depending on catalog order', () => {
    expect(selectTranslationModel(models, { mode: 'recommended' })).toBe(
      'gpt-mini',
    );
    expect(
      selectTranslationModel([...models].reverse(), { mode: 'recommended' }),
    ).toBe('gpt-mini');
    expect(selectTranslationModel([], { mode: 'recommended' })).toBeUndefined();
  });
});
