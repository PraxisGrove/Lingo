import {
  acceptsEndpointQuery,
  DEFAULT_PROVIDER_ENDPOINTS,
  isAiProvider,
  isLocalProviderEndpoint,
  isQwenCompatibleEndpoint,
  providerRequiresCredential,
} from '../providers/config';
import { secretQueryParameter } from '../providers/request-options';
import type { ProviderKind, ProviderProfile } from '../storage/settings-model';

export type ProviderPresetId =
  | 'anthropic'
  | 'gemini'
  | 'qwen'
  | 'doubao'
  | 'zhipu'
  | 'moonshot'
  | 'minimax'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'openai'
  | 'deepseek'
  | 'siliconflow'
  | 'ollama'
  | 'custom'
  | 'deepl'
  | 'google-cloud'
  | 'azure-translator'
  | 'built-in'
  | 'xai'
  | 'together'
  | 'fireworks'
  | 'lmstudio'
  | 'hunyuan'
  | 'qianfan'
  | 'azure-openai'
  | 'local-gateway';

export type ProviderProtocolKind = Extract<
  ProviderKind,
  'openai-compatible' | 'openai-responses' | 'anthropic' | 'gemini'
>;

export type ProviderPreset = {
  id: ProviderPresetId;
  name: string;
  searchKeywords?: readonly string[];
  provider: ProviderKind;
  protocols?: readonly ProviderProtocolKind[];
  category: 'ai' | 'translation' | 'local';
  region: 'china' | 'global' | 'local' | 'translation';
  supportsModelDiscovery: boolean;
  endpoint: string;
  model?: string;
  credentialRequired: boolean;
  docsUrl: string;
  credentialUrl?: string;
  credentialHeader?: ProviderProfile['credentialHeader'];
};

// Presets use each service's base URL; the provider appends its API path.
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'openai',
    region: 'global',
    supportsModelDiscovery: true,
    name: 'OpenAI',
    provider: 'openai-compatible',
    protocols: ['openai-compatible', 'openai-responses'],
    category: 'ai',
    endpoint: DEFAULT_PROVIDER_ENDPOINTS['openai-compatible'],
    model: 'gpt-4.1-mini',
    credentialRequired: true,
    docsUrl: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
    credentialUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'deepseek',
    searchKeywords: ['深度求索', 'DeepSeek'],
    region: 'china',
    supportsModelDiscovery: true,
    name: 'DeepSeek',
    provider: 'openai-compatible',
    protocols: ['openai-compatible', 'openai-responses'],
    category: 'ai',
    endpoint: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    credentialRequired: true,
    docsUrl: 'https://api-docs.deepseek.com/',
    credentialUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'siliconflow',
    searchKeywords: ['硅基流动', 'SiliconFlow'],
    region: 'china',
    supportsModelDiscovery: true,
    name: 'SiliconFlow',
    provider: 'openai-compatible',
    category: 'ai',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    credentialRequired: true,
    docsUrl: 'https://docs.siliconflow.cn/docs/userguide/quickstart',
    credentialUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'anthropic',
    name: 'Anthropic · Claude',
    provider: 'anthropic',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.anthropic.com/v1',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://platform.claude.com/docs/en/api/models/list',
    credentialUrl: 'https://platform.claude.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google · Gemini',
    provider: 'gemini',
    category: 'ai',
    region: 'global',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    credentialUrl: 'https://aistudio.google.com/api-keys',
  },
  {
    id: 'qwen',
    searchKeywords: [
      '阿里',
      '阿里云',
      '百炼',
      '通义',
      '千问',
      '通义千问',
      'Alibaba',
    ],
    name: 'Alibaba Cloud · Qwen',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl:
      'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    credentialUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'doubao',
    searchKeywords: [
      '火山',
      '火山引擎',
      '方舟',
      '字节',
      '豆包',
      '字节跳动',
      'ByteDance',
    ],
    name: 'Volcengine · Doubao',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-mini-260428',
    credentialRequired: true,
    supportsModelDiscovery: false,
    docsUrl: 'https://docs.volcengine.com/docs/ark/quick-start?lang=zh',
    credentialUrl: 'https://console.volcengine.com/ark',
  },
  {
    id: 'zhipu',
    searchKeywords: ['智谱', '智谱AI', 'GLM', 'BigModel'],
    name: 'Zhipu · GLM',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/model-overview',
    credentialUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  {
    id: 'moonshot',
    searchKeywords: ['月之暗面', 'Kimi', 'Moonshot'],
    name: 'Moonshot · Kimi',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://platform.kimi.com/docs/get-api-key',
    credentialUrl: 'https://platform.kimi.com/console/api-keys',
  },
  {
    id: 'minimax',
    searchKeywords: ['海螺', 'MiniMax'],
    name: 'MiniMax',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://api.minimax.io/v1',
    model: 'MiniMax-M2.7',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
    credentialUrl:
      'https://platform.minimax.io/user-center/basic-information/interface-key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://openrouter.ai/docs/api/api-reference/models/get-models',
    credentialUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://console.groq.com/docs/models',
    credentialUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://docs.mistral.ai/api/endpoint/models',
    credentialUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'ollama',
    region: 'local',
    supportsModelDiscovery: true,
    name: 'Ollama',
    provider: 'openai-compatible',
    category: 'local',
    endpoint: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    credentialRequired: false,
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
  },
  {
    id: 'hunyuan',
    searchKeywords: ['腾讯', '混元', 'Tencent'],
    name: 'Tencent Hunyuan',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest',
    credentialRequired: true,
    supportsModelDiscovery: false,
    docsUrl: 'https://cloud.tencent.com/document/product/1729/111007',
    credentialUrl: 'https://console.cloud.tencent.com/hunyuan/start',
  },
  {
    id: 'qianfan',
    searchKeywords: ['百度', '千帆', '文心', 'ERNIE', 'Baidu'],
    name: 'Baidu Qianfan',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'china',
    endpoint: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.5-turbo-32k',
    credentialRequired: true,
    supportsModelDiscovery: false,
    docsUrl: 'https://cloud.baidu.com/doc/qianfan-docs/s/Fm9l6ocai',
    credentialUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
  },
  {
    id: 'xai',
    searchKeywords: ['Grok'],
    name: 'xAI · Grok',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.x.ai/v1',
    model: 'grok-4.3',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://docs.x.ai/docs/api-reference',
    credentialUrl: 'https://console.x.ai/',
  },
  {
    id: 'together',
    name: 'Together AI',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.together.ai/v1',
    credentialRequired: true,
    supportsModelDiscovery: true,
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    credentialUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    endpoint: 'https://api.fireworks.ai/inference/v1',
    model: 'accounts/fireworks/models/qwen3-8b',
    credentialRequired: true,
    supportsModelDiscovery: false,
    docsUrl: 'https://docs.fireworks.ai/tools-sdks/openai-compatibility',
    credentialUrl: 'https://app.fireworks.ai/settings/users/api-keys',
  },
  {
    id: 'azure-openai',
    searchKeywords: ['Azure', 'Microsoft', 'Foundry'],
    name: 'Azure OpenAI',
    provider: 'openai-compatible',
    category: 'ai',
    region: 'global',
    // The reader replaces {resource}; v1 paths need no api-version.
    endpoint: 'https://{resource}.openai.azure.com/openai/v1',
    credentialRequired: true,
    supportsModelDiscovery: true,
    credentialHeader: 'api-key',
    docsUrl:
      'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle',
    credentialUrl: 'https://portal.azure.com/',
  },
  {
    id: 'local-gateway',
    searchKeywords: [
      'Magpie',
      'LiteLLM',
      'One API',
      'New API',
      '网关',
      'gateway',
    ],
    name: 'Local gateway',
    provider: 'openai-compatible',
    protocols: ['openai-compatible', 'openai-responses', 'anthropic', 'gemini'],
    category: 'local',
    region: 'local',
    // Magpie's default address; other gateways only need a different port.
    endpoint: 'http://127.0.0.1:3425/v1',
    credentialRequired: false,
    supportsModelDiscovery: true,
    docsUrl:
      'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    provider: 'openai-compatible',
    category: 'local',
    region: 'local',
    endpoint: 'http://localhost:1234/v1',
    credentialRequired: false,
    supportsModelDiscovery: true,
    docsUrl: 'https://lmstudio.ai/docs/developer/openai-compat',
  },
  {
    id: 'custom',
    region: 'global',
    supportsModelDiscovery: true,
    name: 'OpenAI-compatible',
    provider: 'openai-compatible',
    protocols: ['openai-compatible', 'openai-responses', 'anthropic', 'gemini'],
    category: 'ai',
    endpoint: '',
    credentialRequired: true,
    docsUrl:
      'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
  },
  {
    id: 'deepl',
    region: 'translation',
    supportsModelDiscovery: false,
    name: 'DeepL',
    provider: 'deepl',
    category: 'translation',
    endpoint: DEFAULT_PROVIDER_ENDPOINTS.deepl,
    credentialRequired: true,
    docsUrl: 'https://developers.deepl.com/docs/getting-started/auth',
    credentialUrl: 'https://www.deepl.com/your-account/keys',
  },
  {
    id: 'google-cloud',
    region: 'translation',
    supportsModelDiscovery: false,
    name: 'Google Cloud Translation',
    provider: 'google-cloud',
    category: 'translation',
    endpoint: DEFAULT_PROVIDER_ENDPOINTS['google-cloud'],
    credentialRequired: true,
    docsUrl: 'https://docs.cloud.google.com/translate/docs/authentication',
    credentialUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'azure-translator',
    region: 'translation',
    supportsModelDiscovery: false,
    name: 'Azure Translator',
    provider: 'azure-translator',
    category: 'translation',
    endpoint: DEFAULT_PROVIDER_ENDPOINTS['azure-translator'],
    credentialRequired: true,
    docsUrl:
      'https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication',
    credentialUrl: 'https://portal.azure.com/',
  },
];

// Offered as a dedicated quick-start card rather than in the service grid.
const BUILT_IN_PRESET: ProviderPreset = {
  id: 'built-in',
  region: 'local',
  supportsModelDiscovery: false,
  name: 'Browser on-device translation',
  provider: 'built-in',
  category: 'local',
  endpoint: '',
  credentialRequired: false,
  docsUrl: 'https://developer.chrome.com/docs/ai/translator-api',
};

export function getProviderPreset(id: ProviderPresetId): ProviderPreset {
  if (id === 'built-in') return BUILT_IN_PRESET;
  const preset = PROVIDER_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown provider preset: ${id}`);
  return preset;
}

export function detectProviderPreset(profile: ProviderProfile): ProviderPreset {
  if (
    profile.provider !== 'openai-compatible' &&
    profile.provider !== 'openai-responses'
  ) {
    if (
      profile.endpoint &&
      isAiProvider(profile.provider) &&
      isLocalProviderEndpoint(profile.endpoint) &&
      new URL(profile.endpoint).port === '3425'
    )
      return getProviderPreset('local-gateway');
    const preset = getProviderPreset(profile.provider);
    if (!isAiProvider(profile.provider) || !profile.endpoint) return preset;
    try {
      if (new URL(profile.endpoint).origin === new URL(preset.endpoint).origin)
        return preset;
    } catch {
      // Unfinished native gateway addresses remain editable as custom services.
    }
    return getProviderPreset('custom');
  }
  const endpoint =
    profile.endpoint ?? DEFAULT_PROVIDER_ENDPOINTS['openai-compatible'];
  if (isQwenCompatibleEndpoint(endpoint)) return getProviderPreset('qwen');
  try {
    const url = new URL(endpoint);
    if (isLocalProviderEndpoint(endpoint) && url.port === '11434') {
      return getProviderPreset('ollama');
    }
    if (isLocalProviderEndpoint(endpoint) && url.port === '1234') {
      return getProviderPreset('lmstudio');
    }
    if (isLocalProviderEndpoint(endpoint) && url.port === '3425') {
      return getProviderPreset('local-gateway');
    }
    if (url.hostname.endsWith('.openai.azure.com'))
      return getProviderPreset('azure-openai');
    const preset = PROVIDER_PRESETS.find(
      (item) =>
        item.category === 'ai' &&
        item.endpoint &&
        !item.endpoint.includes('{') &&
        new URL(item.endpoint).origin === url.origin,
    );
    if (preset) return preset;
  } catch {
    // An unfinished custom endpoint stays editable as a custom service.
  }
  return getProviderPreset('custom');
}

export function getProviderProtocols(
  preset: ProviderPreset,
  currentProvider?: ProviderKind,
): readonly ProviderProtocolKind[] {
  const supported =
    preset.protocols ??
    (isAiProvider(preset.provider)
      ? [preset.provider as ProviderProtocolKind]
      : []);
  if (
    currentProvider &&
    isAiProvider(currentProvider) &&
    !supported.includes(currentProvider as ProviderProtocolKind)
  ) {
    // Preserve an explicit saved choice without advertising it for new drafts.
    return [...supported, currentProvider as ProviderProtocolKind];
  }
  return supported;
}

export function createProviderDraft(
  presetId: ProviderPresetId,
  id: string,
): ProviderProfile {
  const preset = getProviderPreset(presetId);
  return {
    id,
    name: preset.name,
    provider: preset.provider,
    endpoint: preset.endpoint,
    ...(preset.model ? { model: preset.model } : {}),
    ...(preset.credentialHeader
      ? { credentialHeader: preset.credentialHeader }
      : {}),
  };
}

export type ProviderDraftField =
  | 'name'
  | 'endpoint'
  | 'model'
  | 'region'
  | 'credential';
export type ProviderDraftError =
  | 'required'
  | 'invalidEndpoint'
  | 'secureEndpoint'
  | 'baseEndpoint'
  | 'invalidRegion';
export type ProviderDraftErrors = Partial<
  Record<ProviderDraftField, ProviderDraftError>
>;

export function validateProviderDraft(
  profile: ProviderProfile,
  credential: string,
  hasStoredCredential = false,
): ProviderDraftErrors {
  const errors: ProviderDraftErrors = {};
  if (!profile.name.trim()) errors.name = 'required';
  if (profile.provider === 'built-in') return errors;
  const endpoint = (
    profile.endpoint ?? DEFAULT_PROVIDER_ENDPOINTS[profile.provider]
  ).trim();
  if (!endpoint) errors.endpoint = 'required';
  else {
    try {
      const url = new URL(endpoint);
      if (
        url.username ||
        url.password ||
        url.hash ||
        /[{}]|%7B|%7D/i.test(endpoint) ||
        (url.search && !acceptsEndpointQuery(profile.provider)) ||
        secretQueryParameter(endpoint)
      ) {
        errors.endpoint = 'invalidEndpoint';
      } else if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && isLocalProviderEndpoint(endpoint))
      ) {
        errors.endpoint = 'secureEndpoint';
      } else if (
        /\/(?:models(?:\/[^/]+)?|messages|chat\/completions|responses|translate|language\/translate\/v2)\/?$/.test(
          url.pathname,
        ) ||
        /:generateContent$/.test(url.pathname)
      ) {
        errors.endpoint = 'baseEndpoint';
      }
    } catch {
      errors.endpoint = 'invalidEndpoint';
    }
  }
  if (isAiProvider(profile.provider) && !profile.model?.trim()) {
    errors.model = 'required';
  }
  if (
    profile.provider === 'azure-translator' &&
    profile.region?.trim() &&
    !/^[a-z0-9-]+$/i.test(profile.region.trim())
  ) {
    errors.region = 'invalidRegion';
  }
  if (
    providerRequiresCredential({ ...profile, endpoint }) &&
    !credential.trim() &&
    !hasStoredCredential
  ) {
    errors.credential = 'required';
  }
  return errors;
}
