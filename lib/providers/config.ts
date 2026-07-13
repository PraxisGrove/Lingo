import type { ProviderKind } from '../storage/settings-model';

export type ProviderField =
  | 'endpoint'
  | 'model'
  | 'region'
  | 'nativeGlossaryId';
export const PROVIDER_DEFINITIONS: Array<{
  value: ProviderKind;
  label: string;
  fields: ProviderField[];
  maxBatchSize: number;
}> = [
  {
    value: 'openai-compatible',
    label: 'OpenAI-compatible',
    fields: ['endpoint', 'model'],
    maxBatchSize: 50,
  },
  {
    value: 'deepl',
    label: 'DeepL',
    fields: ['endpoint', 'nativeGlossaryId'],
    maxBatchSize: 50,
  },
  {
    value: 'google-cloud',
    label: 'Google Cloud Translation',
    fields: ['endpoint'],
    maxBatchSize: 100,
  },
  {
    value: 'azure-translator',
    label: 'Azure Translator',
    fields: ['endpoint', 'region'],
    maxBatchSize: 100,
  },
];
