import { useEffect, useRef, useState } from 'react';
import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import type { MessageKey } from '@/lib/i18n/resources';
import { createLogger } from '@/lib/logger/logger';
import { sendMessage } from '@/lib/messaging/send-message';
import {
  isAiProvider,
  isLocalProviderEndpoint,
  providerRequiresCredential,
} from '@/lib/providers/config';
import type { ProviderModelErrorCategory } from '@/lib/providers/model-discovery';
import {
  type ModelProtocol,
  protocolForModel,
} from '@/lib/providers/model-protocols';
import {
  PROVIDER_ICON_IDS,
  type ProviderIconId,
} from '@/lib/providers/provider-icon-model';
import {
  type ExtensionSettings,
  getSettings,
  type ProviderProfile,
  setSettings,
} from '@/lib/storage/settings';
import {
  PROVIDER_TUNING_LIMITS,
  type ProviderTuning,
  resolveProviderTuning,
} from '@/lib/storage/settings-model';
import {
  importProviderIcon,
  ProviderIconImportError,
} from '@/lib/ui/import-provider-icon';
import { selectTranslationModel } from '@/lib/ui/model-selection';
import { ProviderIcon } from '@/lib/ui/provider-icon';
import {
  createProviderDraft,
  detectProviderPreset,
  getProviderPreset,
  getProviderProtocols,
  PROVIDER_PRESETS,
  type ProviderPresetId,
  type ProviderProtocolKind,
  validateProviderDraft,
} from '@/lib/ui/provider-presets';
import { SettingsIcon } from '@/lib/ui/settings-icon';
import GatewayHeaders, {
  type HeaderDraft,
  headerDraftError,
  headerDraftsFor,
  splitHeaderDrafts,
} from './GatewayHeaders';
import OnDeviceSetup from './OnDeviceSetup';
import './ProviderSetup.css';

const logger = createLogger('provider-setup');
type DiscoveryFailure = {
  category: ProviderModelErrorCategory | 'extension-unavailable';
  status?: number;
  requestUrl?: string;
};
const DISCOVERY_MESSAGES = {
  authentication: 'modelDiscovery.authentication',
  quota: 'modelDiscovery.quota',
  'rate-limit': 'modelDiscovery.rateLimit',
  'invalid-request': 'modelDiscovery.invalidRequest',
  unavailable: 'modelDiscovery.unavailable',
  network: 'modelDiscovery.network',
  'invalid-response': 'modelDiscovery.invalidResponse',
  unsupported: 'modelDiscovery.unsupported',
  'language-pack': 'modelDiscovery.unsupported',
  empty: 'modelDiscovery.empty',
  timeout: 'modelDiscovery.timeout',
  'extension-unavailable': 'modelDiscovery.errors.extensionUnavailable',
} satisfies Record<DiscoveryFailure['category'], MessageKey>;
const PROTOCOL_LABELS = {
  'openai-compatible': 'providerProtocol.chatCompletions',
  'openai-responses': 'providerProtocol.responses',
  anthropic: 'providerProtocol.anthropic',
  gemini: 'providerProtocol.gemini',
} satisfies Record<ProviderProtocolKind, MessageKey>;
const PROTOCOL_SHORT_LABELS = {
  'openai-compatible': 'providerProtocol.short.chat',
  'openai-responses': 'providerProtocol.short.responses',
  anthropic: 'providerProtocol.short.messages',
} satisfies Record<ModelProtocol, MessageKey>;
const CONNECTION_MESSAGES: Record<string, MessageKey> = {
  authentication: 'modelSetup.testErrors.authentication',
  quota: 'modelSetup.testErrors.quota',
  'rate-limit': 'modelSetup.testErrors.rateLimit',
  'invalid-request': 'modelSetup.testErrors.invalidRequest',
  unavailable: 'modelSetup.testErrors.unavailable',
  network: 'modelSetup.testErrors.network',
  'invalid-response': 'modelSetup.testErrors.invalidResponse',
};
type Region = 'all' | 'china' | 'global' | 'local' | 'translation';
const TUNING_FIELDS = [
  'requestsPerMinute',
  'concurrency',
  'timeoutSeconds',
  'maxBatchSize',
  'maxBatchCharacters',
] as const satisfies ReadonlyArray<keyof ProviderTuning>;
type ModelMode = 'recommended' | 'manual';
type BusyAction =
  | 'listing'
  | 'testing'
  | 'saving'
  | 'managing'
  | 'uploading'
  | null;

export type ProviderSetupProps = {
  settings: ExtensionSettings;
  onSettingsChange(next: ExtensionSettings): void;
  onConnected(): void;
  onBack?: () => void;
  keepDraft?: boolean;
};

export default function ProviderSetup({
  settings,
  onSettingsChange,
  onConnected,
  onBack,
  keepDraft = false,
}: ProviderSetupProps) {
  const { t } = useInterfaceTranslation();
  const [presetId, setPresetId] = useState<ProviderPresetId>('openai');
  const [profile, setProfile] = useState<ProviderProfile>(() =>
    createProviderDraft('openai', crypto.randomUUID()),
  );
  const [editorOpen, setEditorOpen] = useState(
    settings.providerProfiles.length === 0,
  );
  const [credential, setCredential] = useState('');
  const [headerDrafts, setHeaderDrafts] = useState<HeaderDraft[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [iconError, setIconError] = useState('');
  const [appearanceStatus, setAppearanceStatus] = useState('');
  const iconFileInput = useRef<HTMLInputElement>(null);
  const [connectionSettingsOpen, setConnectionSettingsOpen] = useState(false);
  const [region, setRegion] = useState<Region>('all');
  const [providerSearch, setProviderSearch] = useState('');
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [catalogReady, setCatalogReady] = useState(false);
  const [stepsCollapsed, setStepsCollapsed] = useState(false);
  const [catalogTransition, setCatalogTransition] = useState(0);
  const [connectionEditVersion, setConnectionEditVersion] = useState(0);
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const [discoveryFailure, setDiscoveryFailure] =
    useState<DiscoveryFailure | null>(null);
  const [discoveryFailureVersion, setDiscoveryFailureVersion] = useState(0);
  const discoveryFailureHeading = useRef<HTMLHeadingElement>(null);
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [mode, setMode] = useState<ModelMode>('recommended');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [status, setStatus] = useState('');
  const [protocolNote, setProtocolNote] = useState('');
  const [statusFocusVersion, setStatusFocusVersion] = useState(0);
  const [focusField, setFocusField] = useState<{ name: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const formError = useRef<HTMLParagraphElement>(null);
  const [ready, setReady] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    ReturnType<typeof validateProviderDraft>
  >({});
  const requestVersion = useRef(0);
  const preset = getProviderPreset(presetId);
  const protocolOptions = getProviderProtocols(preset, profile.provider);
  const storedProfile = settings.providerProfiles.find(
    (item) => item.id === profile.id,
  );
  const appearanceChanged = Boolean(
    storedProfile &&
      (profile.name.trim() !== storedProfile.name ||
        JSON.stringify(profile.icon) !== JSON.stringify(storedProfile.icon)),
  );
  const iconChoice =
    profile.icon?.type === 'provider'
      ? profile.icon.providerId
      : profile.icon?.type === 'image'
        ? 'uploaded'
        : '';
  const models = profile.models ?? [];
  const selectedModel = models.find((model) => model.id === profile.model);
  const filteredModels = models.filter((model) =>
    `${model.id} ${model.name}`
      .toLowerCase()
      .includes(modelSearch.toLowerCase().trim()),
  );
  const visibleProviders = PROVIDER_PRESETS.filter(
    (item) =>
      (region === 'all' || item.region === region) &&
      [item.name, ...(item.searchKeywords ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(providerSearch.toLowerCase().trim()),
  );
  const displayedProviders =
    showAllProviders || region !== 'all' || providerSearch.trim()
      ? visibleProviders
      : visibleProviders.slice(0, 6);
  const documentationPreset =
    preset.id === 'custom' && ['anthropic', 'gemini'].includes(profile.provider)
      ? getProviderPreset(profile.provider as 'anthropic' | 'gemini')
      : preset;
  const requiresCredential = providerRequiresCredential(profile);
  const canChooseModel = isAiProvider(profile.provider);
  // Gateways are named by the reader, so their name sits beside the address.
  const namedService = preset.id === 'custom' || preset.id === 'local-gateway';
  const endpointInMain =
    preset.id === 'custom' ||
    preset.id === 'azure-openai' ||
    preset.region === 'local' ||
    showEndpoint;
  const discoveryRequest = safeDiscoveryRequest(discoveryFailure?.requestUrl);

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (catalogTransition > 0) focusStep(catalogHeading.current);
  }, [catalogTransition]);

  useEffect(() => {
    if (connectionEditVersion > 0) focusStep(keyInput.current);
  }, [connectionEditVersion]);

  useEffect(() => {
    if (discoveryFailureVersion > 0) focusStep(discoveryFailureHeading.current);
  }, [discoveryFailureVersion]);

  useEffect(() => {
    if (focusField)
      focusStep(
        form.current?.querySelector<HTMLElement>(
          `[name="${focusField.name}"]`,
        ) ?? null,
      );
  }, [focusField]);

  useEffect(() => {
    if (statusFocusVersion > 0) focusStep(formError.current);
  }, [statusFocusVersion]);

  function reportDiscoveryFailure(failure: DiscoveryFailure) {
    setDiscoveryFailure(failure);
    setDiscoveryFailed(true);
    setStepsCollapsed(false);
    setShowKey(false);
    setShowEndpoint(true);
    setCatalogReady(false);
    setDiscoveryFailureVersion((current) => current + 1);
  }

  function finishConnectionStep() {
    setCatalogReady(true);
    setDiscoveryFailure(null);
    setShowEndpoint(false);
    setStepsCollapsed(true);
    setShowKey(false);
    setCatalogTransition((current) => current + 1);
  }

  function presetName(item: { id: ProviderPresetId; name: string }) {
    if (item.id === 'custom') return t('modelSetup.customName');
    if (item.id === 'local-gateway') return t('modelSetup.localGateway');
    return item.name;
  }

  function choosePreset(id: ProviderPresetId) {
    requestVersion.current += 1;
    setPresetId(id);
    setStepsCollapsed(false);
    setDiscoveryFailure(null);
    setShowEndpoint(false);
    setIconError('');
    setAppearanceStatus('');
    setProtocolNote('');
    const draft = createProviderDraft(id, crypto.randomUUID());
    setProfile(
      id === 'local-gateway'
        ? { ...draft, name: t('modelSetup.localGateway') }
        : draft,
    );
    setHeaderDrafts([]);
    setCredential('');
    setShowKey(false);
    setConnectionSettingsOpen(false);
    const manualOnly =
      isAiProvider(getProviderPreset(id).provider) &&
      !getProviderPreset(id).supportsModelDiscovery;
    setMode(manualOnly ? 'manual' : 'recommended');
    setCatalogReady(manualOnly);
    setDiscoveryFailed(false);
    setModelSearch('');
    setErrors({});
    setStatus('');
    setReady(false);
    setDeleteId(null);
  }

  function editProfile(saved: ProviderProfile) {
    requestVersion.current += 1;
    setPresetId(detectProviderPreset(saved).id);
    setStepsCollapsed(false);
    setDiscoveryFailure(null);
    setShowEndpoint(false);
    setIconError('');
    setAppearanceStatus('');
    const edited = {
      ...saved,
      ...(saved.provider === 'openai-compatible' && !saved.model
        ? { model: 'gpt-4.1-mini' }
        : {}),
    };
    setProfile(edited);
    setProtocolNote('');
    setHeaderDrafts(headerDraftsFor(saved));
    setCredential('');
    setShowKey(false);
    setConnectionSettingsOpen(false);
    setMode(saved.modelSelection ?? 'manual');
    setCatalogReady(Boolean(edited.model));
    setDiscoveryFailed(false);
    setModelSearch('');
    setErrors({});
    setStatus('');
    setReady(false);
    setEditorOpen(true);
    setFocusField({ name: 'credential' });
    setDeleteId(null);
  }

  function changeAppearance(
    patch: Partial<Pick<ProviderProfile, 'name' | 'icon'>>,
  ) {
    setProfile((current) => ({ ...current, ...patch }));
    setIconError('');
    setAppearanceStatus('');
  }

  async function uploadIcon(file: File, input: HTMLInputElement) {
    if (busy) return;
    const version = ++requestVersion.current;
    setBusy('uploading');
    setIconError('');
    setAppearanceStatus('');
    try {
      const dataUrl = await importProviderIcon(file);
      if (version !== requestVersion.current) return;
      changeAppearance({ icon: { type: 'image', dataUrl } });
    } catch (error) {
      if (version !== requestVersion.current) return;
      setIconError(
        t(
          error instanceof ProviderIconImportError
            ? `customIcon.errors.${error.code}`
            : 'customIcon.errors.generic',
        ),
      );
    } finally {
      input.value = '';
      if (version === requestVersion.current) setBusy(null);
    }
  }

  async function saveAppearance() {
    if (busy || !storedProfile) return;
    const name = profile.name.trim();
    if (!name) {
      setErrors((current) => ({ ...current, name: 'required' }));
      setConnectionSettingsOpen(true);
      setFocusField({ name: 'name' });
      return;
    }
    setBusy('managing');
    setIconError('');
    setAppearanceStatus('');
    try {
      const latest = await getSettings();
      const saved = latest.providerProfiles.find(
        (item) => item.id === profile.id,
      );
      if (!saved) throw new Error('The edited provider no longer exists.');
      const updated: ProviderProfile = { ...saved, name };
      if (profile.icon) updated.icon = profile.icon;
      else delete updated.icon;
      const next = await setSettings({
        providerProfiles: latest.providerProfiles.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      });
      onSettingsChange(next);
      setAppearanceStatus(t('customIcon.appearanceSaved'));
    } catch (error) {
      logger.error('Could not save service appearance.', { error });
      setIconError(t('modelSetup.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  function updateConnection(patch: Partial<ProviderProfile>) {
    requestVersion.current += 1;
    setDiscoveryFailure(null);
    setProfile((current) => ({ ...current, ...patch, models: undefined }));
    setErrors({});
    setStatus('');
    setCatalogReady(canChooseModel && !preset.supportsModelDiscovery);
    setDiscoveryFailed(false);
  }

  function validate(requireModel: boolean) {
    const { headers } = splitHeaderDrafts(headerDrafts);
    const normalized = normalizeProfile({
      ...profile,
      headers: headers.length ? headers : undefined,
    });
    if (headerDrafts.some(headerDraftError)) {
      setConnectionSettingsOpen(true);
      setStatus(t('modelSetup.headers.invalid'));
      setStatusFocusVersion((current) => current + 1);
      return null;
    }
    const nextErrors = validateProviderDraft(
      normalized,
      credential.trim(),
      Boolean(storedProfile),
    );
    if (!requireModel) delete nextErrors.model;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (Object.keys(nextErrors).some((field) => field !== 'model'))
        setStepsCollapsed(false);
      if (
        nextErrors.name ||
        nextErrors.region ||
        (nextErrors.endpoint &&
          preset.id !== 'custom' &&
          preset.id !== 'azure-openai' &&
          preset.region !== 'local')
      )
        setConnectionSettingsOpen(true);
      if (nextErrors.model) setMode('manual');
      setStatus(t('modelSetup.required'));
      setFocusField({ name: Object.keys(nextErrors)[0] });
      return null;
    }
    return normalized;
  }

  async function discoverModels() {
    if (busy) return;
    const draft = validate(false);
    if (!draft) return;
    const version = ++requestVersion.current;
    setBusy('listing');
    setStatus('');
    setDiscoveryFailed(false);
    setDiscoveryFailure(null);
    try {
      const result = await sendMessage('listProviderModels', {
        profile: draft,
        credential: credential.trim(),
        headerSecrets: splitHeaderDrafts(headerDrafts).secrets,
      });
      if (version !== requestVersion.current) return;
      if (
        !result ||
        typeof result !== 'object' ||
        typeof result.ok !== 'boolean' ||
        (result.ok &&
          (!Array.isArray(result.models) ||
            !result.models.every(
              (model) =>
                model &&
                typeof model.id === 'string' &&
                typeof model.name === 'string',
            )))
      ) {
        reportDiscoveryFailure({ category: 'extension-unavailable' });
        return;
      }
      if (!result.ok) {
        reportDiscoveryFailure(
          Object.hasOwn(DISCOVERY_MESSAGES, result.category)
            ? {
                category: result.category,
                status: result.status,
                requestUrl: result.requestUrl,
              }
            : { category: 'extension-unavailable' },
        );
        return;
      }
      finishConnectionStep();
      const nextModel = selectTranslationModel(result.models, {
        mode,
        currentModel: draft.model,
        preferredModel: preset.model,
      });
      applyModelSelection({
        ...draft,
        ...(result.resolvedEndpoint
          ? { endpoint: result.resolvedEndpoint }
          : {}),
        models: result.models,
        model: nextModel,
        modelSelection: mode,
      });
      if (result.models.length === 0) setMode('manual');
    } catch (error) {
      if (version !== requestVersion.current) return;
      logger.warn('Could not discover provider models.', { error });
      reportDiscoveryFailure({ category: 'extension-unavailable' });
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  }

  function chooseMode(nextMode: ModelMode) {
    setMode(nextMode);
    setErrors({});
    applyModelSelection({
      ...profile,
      modelSelection: nextMode,
      model: selectTranslationModel(profile.models ?? [], {
        mode: nextMode,
        currentModel: profile.model,
        preferredModel: preset.model,
      }),
    });
  }

  /** Switch to a protocol the chosen gateway model supports, when allowed. */
  function applyModelSelection(next: ProviderProfile) {
    const model = next.models?.find((item) => item.id === next.model);
    const provider = protocolForModel(model, next.provider);
    const switches =
      provider !== next.provider &&
      getProviderProtocols(preset, next.provider).includes(
        provider as ProviderProtocolKind,
      );
    setProfile(switches ? { ...next, provider } : next);
    setStatus('');
    if (switches)
      setProtocolNote(
        t('modelSetup.protocolSwitched', {
          protocol: t(PROTOCOL_LABELS[provider as ProviderProtocolKind]),
        }),
      );
  }

  function chooseModel(model: string) {
    setMode('manual');
    setErrors({});
    applyModelSelection({ ...profile, model, modelSelection: 'manual' });
  }

  async function saveAndTest() {
    if (busy) return;
    const draft = validate(canChooseModel);
    if (!draft) return;
    const version = ++requestVersion.current;
    const selected = canChooseModel
      ? { ...draft, modelSelection: mode }
      : draft;
    setBusy('testing');
    setStatus('');
    setReady(false);
    try {
      const result = await sendMessage('testProviderConnection', {
        profile: selected,
        credential: credential.trim(),
        headerSecrets: splitHeaderDrafts(headerDrafts).secrets,
      });
      if (version !== requestVersion.current) return;
      if (!result?.ok) {
        setStatus(
          t(
            result && Object.hasOwn(CONNECTION_MESSAGES, result.category)
              ? CONNECTION_MESSAGES[result.category]
              : 'modelSetup.testErrors.generic',
          ),
        );
        setStatusFocusVersion((current) => current + 1);
        return;
      }
      setBusy('saving');
      await sendMessage('saveProviderProfile', {
        profile: selected,
        credential: credential.trim(),
        headerSecrets: splitHeaderDrafts(headerDrafts).secrets,
      });
      if (version !== requestVersion.current) return;
      const next = await setSettings({ setupCompleted: true });
      if (version !== requestVersion.current) return;
      onSettingsChange(next);
      setCredential('');
      setHeaderDrafts(headerDraftsFor(selected));
      setShowKey(false);
      setProfile(selected);
      setReady(true);
      setEditorOpen(false);
      onConnected();
    } catch (error) {
      if (version !== requestVersion.current) return;
      logger.error('Could not test and save provider.', { error });
      setStatus(t('modelSetup.saveFailed'));
      setStatusFocusVersion((current) => current + 1);
    } finally {
      if (version === requestVersion.current) setBusy(null);
    }
  }

  async function manageSettings(patch: Partial<ExtensionSettings>) {
    if (busy) return;
    setBusy('managing');
    setStatus('');
    try {
      onSettingsChange(await setSettings(patch));
    } catch (error) {
      logger.error('Could not update provider preferences.', { error });
      setStatus(t('modelSetup.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function deleteProfile() {
    if (busy || !deleteId) return;
    setBusy('managing');
    setStatus('');
    try {
      await sendMessage('deleteProviderProfile', { profileId: deleteId });
      const next = await getSettings();
      onSettingsChange(next);
      setDeleteId(null);
      setReady(false);
      if (next.providerProfiles.length === 0) {
        choosePreset('openai');
        setEditorOpen(true);
      } else if (deleteId === profile.id) setEditorOpen(false);
    } catch (error) {
      logger.error('Could not delete provider.', { error });
      setStatus(t('modelSetup.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  function fieldError(field: keyof typeof errors) {
    if (!errors[field]) return null;
    return (
      <small id={`model-setup-${field}-error`} className="model-field-error">
        {t(`modelSetup.validation.${errors[field]}` as MessageKey)}
      </small>
    );
  }

  const nameField = (
    <label className="model-draft-field">
      {t('modelSetup.name')}
      <input
        name="name"
        value={profile.name}
        aria-invalid={Boolean(errors.name)}
        aria-describedby={errors.name ? 'model-setup-name-error' : undefined}
        onChange={(event) =>
          changeAppearance({ name: event.currentTarget.value })
        }
      />
      {fieldError('name')}
    </label>
  );
  const appearanceSaveAction =
    storedProfile && appearanceChanged ? (
      <button
        className="model-save-appearance"
        type="button"
        onClick={() => void saveAppearance()}
      >
        {t('customIcon.saveAppearance')}
      </button>
    ) : null;

  return (
    <div className="model-setup" aria-busy={Boolean(busy)}>
      <div className="model-setup-title">
        <div>
          <h2 id="provider-heading">{t('modelSetup.title')}</h2>
          <p>{t('modelSetup.intro')}</p>
        </div>
        {settings.providerProfiles.length > 0 && !editorOpen && (
          <button
            className="primary-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => {
              choosePreset('openai');
              setEditorOpen(true);
              setFocusField({ name: 'providerSearch' });
            }}
          >
            <SettingsIcon name="plus" size={16} />
            {t('modelSetup.add')}
          </button>
        )}
      </div>

      {ready && (
        <div className="model-ready" role="status">
          <SettingsIcon name="check" />
          <div>
            <strong>{t('modelSetup.savedReady')}</strong>
            <p>{t('modelSetup.readyHelp')}</p>
          </div>
        </div>
      )}

      <OnDeviceSetup
        settings={settings}
        onSettingsChange={onSettingsChange}
        onConnected={() => {
          setReady(true);
          setEditorOpen(false);
          onConnected();
        }}
      />

      {settings.providerProfiles.length > 0 && (
        <section
          className="model-saved-services"
          aria-label={t('modelSetup.saved')}
        >
          <h3>{t('modelSetup.saved')}</h3>
          <div className="model-saved-list">
            {settings.providerProfiles.map((saved) => (
              <article className="model-saved-service" key={saved.id}>
                <span className="model-provider-mark" aria-hidden="true">
                  <ProviderIcon
                    presetId={detectProviderPreset(saved).id}
                    icon={saved.icon}
                    size={22}
                  />
                </span>
                <div className="model-saved-description">
                  <strong>{saved.name}</strong>
                  <small>
                    {saved.model ?? detectProviderPreset(saved).name}
                  </small>
                </div>
                {saved.id === settings.activeProviderProfileId ? (
                  <span className="model-default-badge">
                    {t('modelSetup.default')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void manageSettings({
                        activeProviderProfileId: saved.id,
                        fallbackProviderProfileIds:
                          settings.fallbackProviderProfileIds.filter(
                            (id) => id !== saved.id,
                          ),
                      })
                    }
                  >
                    {t('modelSetup.useDefault')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  aria-label={t('modelSetup.edit', { name: saved.name })}
                  onClick={() => editProfile(saved)}
                >
                  <SettingsIcon name="general" size={15} />
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  aria-label={t('modelSetup.delete', { name: saved.name })}
                  onClick={() => setDeleteId(saved.id)}
                >
                  ×
                </button>
              </article>
            ))}
          </div>
          {deleteId && (
            <div className="model-delete-confirm">
              <strong>{t('modelSetup.confirmDelete')}</strong>
              <p>{t('modelSetup.confirmDeleteHelp')}</p>
              <div>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setDeleteId(null)}
                >
                  {t('modelSetup.cancel')}
                </button>
                <button
                  className="model-danger-button"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void deleteProfile()}
                >
                  {t('modelSetup.deleteAction')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {editorOpen && (
        <form
          ref={form}
          className="model-setup-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canChooseModel && !catalogReady) void discoverModels();
            else void saveAndTest();
          }}
          noValidate
        >
          <fieldset disabled={Boolean(busy)}>
            {stepsCollapsed ? (
              <div className="model-completed-connection">
                <span className="model-provider-mark" aria-hidden="true">
                  <ProviderIcon
                    presetId={detectProviderPreset(profile).id}
                    icon={profile.icon}
                    size={22}
                  />
                </span>
                <div className="model-completed-description">
                  <small>{t('modelSetup.chooseProvider')}</small>
                  <strong>{profile.name}</strong>
                  <span>{profile.endpoint ?? preset.endpoint}</span>
                </div>
                <div className="model-summary-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setStepsCollapsed(false);
                      setConnectionEditVersion((current) => current + 1);
                    }}
                  >
                    <SettingsIcon name="general" size={14} />
                    {t('modelSetup.connectionSettings')}
                  </button>
                  <a
                    className="model-provider-docs"
                    href={documentationPreset.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('experience.provider.docs')}
                    <SettingsIcon name="external" size={12} />
                  </a>
                </div>
              </div>
            ) : (
              <>
                <section className="model-setup-step model-provider-step">
                  <div className="model-step-heading">
                    <h3>{t('modelSetup.chooseProvider')}</h3>
                  </div>
                  <div className="model-provider-filters">
                    {(
                      [
                        'all',
                        'china',
                        'global',
                        'local',
                        'translation',
                      ] as const
                    ).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={region === value}
                        onClick={() => setRegion(value)}
                      >
                        {t(`providerRegion.${value}`)}
                      </button>
                    ))}
                  </div>
                  <label className="model-provider-search">
                    <span className="visually-hidden">
                      {t('modelSetup.providerSearch')}
                    </span>
                    <input
                      name="providerSearch"
                      type="search"
                      value={providerSearch}
                      placeholder={t('modelSetup.providerSearch')}
                      onChange={(event) =>
                        setProviderSearch(event.currentTarget.value)
                      }
                    />
                  </label>
                  <div className="model-provider-grid">
                    {displayedProviders.map((item) => (
                      <button
                        className="model-provider-choice"
                        type="button"
                        key={item.id}
                        aria-pressed={presetId === item.id}
                        onClick={() => choosePreset(item.id)}
                      >
                        <span
                          className="model-provider-mark"
                          aria-hidden="true"
                        >
                          <ProviderIcon presetId={item.id} size={22} />
                        </span>
                        <span>
                          {presetName(item)}
                          <small>{t(`providerRegion.${item.region}`)}</small>
                        </span>
                        {presetId === item.id && (
                          <SettingsIcon name="check" size={16} />
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    className="model-add-custom-service"
                    type="button"
                    aria-pressed={presetId === 'custom'}
                    onClick={() => choosePreset('custom')}
                  >
                    <SettingsIcon name="plus" size={15} />
                    {t('customService.add')}
                  </button>
                  {!showAllProviders &&
                    region === 'all' &&
                    !providerSearch.trim() &&
                    visibleProviders.length > 6 && (
                      <button
                        className="model-more-providers"
                        type="button"
                        onClick={() => setShowAllProviders(true)}
                      >
                        {t('modelSetup.moreProviders')}
                        <SettingsIcon name="plus" size={14} />
                      </button>
                    )}
                </section>

                <section className="model-setup-step">
                  <div className="model-step-heading">
                    <h3>{t('modelSetup.connectAccount')}</h3>
                    <strong className="model-current-provider">
                      {presetName(preset)}
                    </strong>
                  </div>
                  {discoveryFailure && (
                    <section className="model-discovery-error" role="alert">
                      <div className="model-discovery-error-heading">
                        <h4 ref={discoveryFailureHeading} tabIndex={-1}>
                          {t('modelDiscovery.failed')}
                        </h4>
                        {discoveryFailure.status && (
                          <span>
                            {t('modelDiscovery.httpStatus', {
                              status: discoveryFailure.status,
                            })}
                          </span>
                        )}
                      </div>
                      <p>{t(DISCOVERY_MESSAGES[discoveryFailure.category])}</p>
                      {discoveryRequest && (
                        <div className="model-discovery-request">
                          <span>{t('modelDiscovery.request')}</span>
                          <code>{`GET ${discoveryRequest}`}</code>
                        </div>
                      )}
                      <div className="model-discovery-error-actions">
                        {discoveryFailure.category ===
                        'extension-unavailable' ? (
                          <button
                            type="button"
                            onClick={() => browser.runtime.reload()}
                          >
                            {t('modelDiscovery.reload')}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void discoverModels()}
                            >
                              {t('modelDiscovery.retry')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                chooseMode('manual');
                                finishConnectionStep();
                              }}
                            >
                              {t('modelDiscovery.manual')}
                            </button>
                          </>
                        )}
                      </div>
                    </section>
                  )}
                  {namedService && nameField}
                  {protocolOptions.length > 1 && (
                    <label className="model-draft-field">
                      {t('customService.protocol')}
                      <select
                        name="protocol"
                        value={profile.provider}
                        onChange={(event) => {
                          const provider = event.currentTarget
                            .value as ProviderProfile['provider'];
                          if (!isAiProvider(provider)) return;
                          updateConnection({
                            provider,
                            model: undefined,
                            models: undefined,
                            modelSelection: 'recommended',
                          });
                          setMode('recommended');
                        }}
                      >
                        {protocolOptions.map((protocol) => (
                          <option key={protocol} value={protocol}>
                            {t(PROTOCOL_LABELS[protocol])}
                          </option>
                        ))}
                      </select>
                      <small className="model-field-help">
                        {t('customService.protocolHelp')}
                      </small>
                    </label>
                  )}

                  <div className="model-key-heading">
                    <label htmlFor="model-setup-key">
                      {t(
                        requiresCredential
                          ? 'modelSetup.key'
                          : 'modelSetup.keyOptional',
                      )}
                    </label>
                    {preset.credentialUrl && (
                      <a
                        href={preset.credentialUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('modelSetup.getKey')}
                        <SettingsIcon name="external" size={12} />
                      </a>
                    )}
                  </div>
                  <div className="model-key-input">
                    <input
                      id="model-setup-key"
                      ref={keyInput}
                      name="credential"
                      type={showKey ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={credential}
                      aria-invalid={Boolean(errors.credential)}
                      aria-describedby={
                        errors.credential
                          ? 'model-setup-credential-error'
                          : undefined
                      }
                      placeholder={t(
                        storedProfile
                          ? 'modelSetup.keepKey'
                          : 'modelSetup.keyPlaceholder',
                      )}
                      onChange={(event) => {
                        requestVersion.current += 1;
                        setCredential(event.currentTarget.value);
                        setDiscoveryFailure(null);
                        setCatalogReady(
                          canChooseModel && !preset.supportsModelDiscovery,
                        );
                        setProfile((current) => ({
                          ...current,
                          models: undefined,
                        }));
                        setErrors({});
                        setStatus('');
                      }}
                    />
                    <button
                      type="button"
                      aria-label={t(
                        showKey ? 'modelSetup.hideKey' : 'modelSetup.showKey',
                      )}
                      aria-pressed={showKey}
                      onClick={() => setShowKey(!showKey)}
                    >
                      <SettingsIcon name="eye" size={18} />
                    </button>
                  </div>
                  {fieldError('credential')}
                  {!requiresCredential && (
                    <p className="model-field-help">
                      {t('modelSetup.localHelp')}
                    </p>
                  )}
                  {endpointInMain && (
                    <label className="model-draft-field">
                      {t('modelSetup.endpoint')}
                      <input
                        name="endpoint"
                        value={profile.endpoint ?? ''}
                        aria-invalid={Boolean(errors.endpoint)}
                        aria-describedby={
                          errors.endpoint
                            ? 'model-setup-endpoint-error'
                            : undefined
                        }
                        onChange={(event) =>
                          updateConnection({
                            endpoint: event.currentTarget.value,
                          })
                        }
                      />
                      {fieldError('endpoint')}
                    </label>
                  )}
                  {(preset.id === 'custom' ||
                    isLocalProviderEndpoint(profile.endpoint ?? '')) && (
                    <p className="model-field-help">
                      {t(
                        preset.id === 'local-gateway'
                          ? 'modelSetup.localGatewayHelp'
                          : 'modelDiscovery.gatewayHelp',
                      )}
                    </p>
                  )}
                  {profile.provider === 'deepl' && (
                    <label className="model-draft-field">
                      {t('experience.provider.deeplPlan')}
                      <select
                        name="deeplPlan"
                        value={profile.endpoint ?? 'https://api-free.deepl.com'}
                        onChange={(event) =>
                          updateConnection({
                            endpoint: event.currentTarget.value,
                          })
                        }
                      >
                        <option value="https://api-free.deepl.com">
                          {t('experience.provider.deeplFree')}
                        </option>
                        <option value="https://api.deepl.com">
                          {t('experience.provider.deeplPro')}
                        </option>
                        {profile.endpoint &&
                          ![
                            'https://api-free.deepl.com',
                            'https://api.deepl.com',
                          ].includes(profile.endpoint) && (
                            <option value={profile.endpoint}>
                              {t('modelSetup.customName')}
                            </option>
                          )}
                      </select>
                      <small className="model-field-help">
                        {t('experience.provider.deeplHelp')}
                      </small>
                    </label>
                  )}
                  <details
                    className="model-connection-settings"
                    open={connectionSettingsOpen}
                    onToggle={(event) =>
                      setConnectionSettingsOpen(event.currentTarget.open)
                    }
                  >
                    <summary>{t('modelSetup.moreSettings')}</summary>
                    <div>
                      {!namedService && nameField}
                      <section
                        className="model-icon-settings"
                        aria-labelledby="model-custom-icon-heading"
                      >
                        <div className="model-icon-settings-heading">
                          <span
                            className="model-provider-mark"
                            aria-hidden="true"
                          >
                            <ProviderIcon
                              presetId={detectProviderPreset(profile).id}
                              icon={profile.icon}
                              size={24}
                            />
                          </span>
                          <div>
                            <h4 id="model-custom-icon-heading">
                              {t('customIcon.title')}
                            </h4>
                            <p>{t('customIcon.editHint')}</p>
                          </div>
                        </div>
                        <label className="model-draft-field">
                          {t('customIcon.choice')}
                          <select
                            name="iconSource"
                            value={iconChoice}
                            onChange={(event) => {
                              const choice = event.currentTarget.value;
                              if (choice === '')
                                changeAppearance({ icon: undefined });
                              else if (
                                PROVIDER_ICON_IDS.includes(
                                  choice as ProviderIconId,
                                )
                              )
                                changeAppearance({
                                  icon: {
                                    type: 'provider',
                                    providerId: choice as ProviderIconId,
                                  },
                                });
                            }}
                          >
                            <option value="">{t('customIcon.auto')}</option>
                            {profile.icon?.type === 'image' && (
                              <option value="uploaded">
                                {t('customIcon.uploaded')}
                              </option>
                            )}
                            {PROVIDER_PRESETS.map((item) => (
                              <option value={item.id} key={item.id}>
                                {item.id === 'custom'
                                  ? t('customIcon.generic')
                                  : presetName(item)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="model-icon-actions">
                          <input
                            ref={iconFileInput}
                            id="model-custom-icon-file"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={(event) => {
                              const input = event.currentTarget;
                              const file = input.files?.[0];
                              if (file) void uploadIcon(file, input);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => iconFileInput.current?.click()}
                          >
                            {busy === 'uploading'
                              ? t('customIcon.uploading')
                              : t('customIcon.upload')}
                          </button>
                          {profile.icon && (
                            <button
                              type="button"
                              onClick={() =>
                                changeAppearance({ icon: undefined })
                              }
                            >
                              {t('customIcon.reset')}
                            </button>
                          )}
                        </div>
                        <small className="model-field-help">
                          {t('customIcon.help')}
                        </small>
                        {iconError && (
                          <p className="model-field-error" role="status">
                            {iconError}
                          </p>
                        )}
                        {appearanceStatus && (
                          <p className="model-appearance-status" role="status">
                            {appearanceStatus}
                          </p>
                        )}
                      </section>
                      {!endpointInMain && (
                        <label className="model-draft-field">
                          {t('modelSetup.endpoint')}
                          <input
                            name="endpoint"
                            value={profile.endpoint ?? ''}
                            aria-invalid={Boolean(errors.endpoint)}
                            aria-describedby={
                              errors.endpoint
                                ? 'model-setup-endpoint-error'
                                : undefined
                            }
                            onChange={(event) =>
                              updateConnection({
                                endpoint: event.currentTarget.value,
                              })
                            }
                          />
                          {fieldError('endpoint')}
                        </label>
                      )}
                      {profile.provider === 'azure-translator' && (
                        <label className="model-draft-field">
                          {t('modelSetup.region')}
                          <input
                            name="region"
                            value={profile.region ?? ''}
                            aria-invalid={Boolean(errors.region)}
                            aria-describedby={
                              errors.region
                                ? 'model-setup-region-error'
                                : undefined
                            }
                            onChange={(event) =>
                              updateConnection({
                                region: event.currentTarget.value,
                              })
                            }
                          />
                          {fieldError('region')}
                        </label>
                      )}
                      {profile.provider === 'deepl' && (
                        <label className="model-draft-field">
                          {t('modelSetup.glossary')}
                          <input
                            name="nativeGlossaryId"
                            value={profile.nativeGlossaryId ?? ''}
                            onChange={(event) =>
                              updateConnection({
                                nativeGlossaryId: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                      )}
                      {canChooseModel && (
                        <>
                          {profile.provider !== 'gemini' && (
                            <label className="model-draft-field">
                              {t('modelSetup.authHeader')}
                              <select
                                name="credentialHeader"
                                value={profile.credentialHeader ?? 'default'}
                                onChange={(event) =>
                                  updateConnection({
                                    credentialHeader:
                                      event.currentTarget.value === 'api-key'
                                        ? 'api-key'
                                        : undefined,
                                  })
                                }
                              >
                                <option value="default">
                                  {t('modelSetup.authHeader.default')}
                                </option>
                                <option value="api-key">
                                  {t('modelSetup.authHeader.apiKey')}
                                </option>
                              </select>
                            </label>
                          )}
                          <GatewayHeaders
                            drafts={headerDrafts}
                            onChange={(next) => {
                              requestVersion.current += 1;
                              setHeaderDrafts(next);
                              setDiscoveryFailure(null);
                              setErrors({});
                              setStatus('');
                            }}
                          />
                        </>
                      )}
                      <fieldset className="model-tuning">
                        <legend>{t('modelSetup.tuning.title')}</legend>
                        <p className="model-field-help">
                          {t('modelSetup.tuning.help')}
                        </p>
                        {TUNING_FIELDS.map((field) => (
                          <label className="model-draft-field" key={field}>
                            {t(`modelSetup.tuning.${field}`)}
                            <input
                              name={`tuning-${field}`}
                              type="number"
                              inputMode="numeric"
                              min={PROVIDER_TUNING_LIMITS[field][0]}
                              max={PROVIDER_TUNING_LIMITS[field][1]}
                              placeholder={t('modelSetup.tuning.default')}
                              value={profile.tuning?.[field] ?? ''}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setProfile((current) => {
                                  const tuning = { ...current.tuning };
                                  if (value === '') delete tuning[field];
                                  else tuning[field] = Number(value);
                                  return {
                                    ...current,
                                    tuning: resolveProviderTuning(tuning),
                                  };
                                });
                              }}
                            />
                          </label>
                        ))}
                      </fieldset>
                    </div>
                  </details>
                  {appearanceSaveAction}
                  {canChooseModel && preset.supportsModelDiscovery && (
                    <button
                      className="primary-button model-connect-button"
                      type="button"
                      onClick={() => void discoverModels()}
                    >
                      {busy === 'listing'
                        ? t('modelSetup.connecting')
                        : t('modelSetup.connect')}
                      <SettingsIcon name="arrow" size={17} />
                    </button>
                  )}
                  <a
                    className="model-provider-docs"
                    href={documentationPreset.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('experience.provider.docs')}
                    <SettingsIcon name="external" size={12} />
                  </a>
                  <p className="model-device-note">
                    <SettingsIcon name="lock" size={13} />
                    {t('modelSetup.privacy')}
                  </p>
                </section>
              </>
            )}

            {canChooseModel && catalogReady && (
              <section className="model-setup-step model-catalog-step">
                <div className="model-step-heading">
                  <h3 ref={catalogHeading} tabIndex={-1}>
                    {t('modelSetup.chooseModel')}
                  </h3>
                  {preset.supportsModelDiscovery && (
                    <button
                      className="model-refresh"
                      type="button"
                      onClick={() => void discoverModels()}
                    >
                      {t('modelSetup.refresh')}
                    </button>
                  )}
                </div>
                {preset.supportsModelDiscovery && (
                  <fieldset
                    className="model-policy"
                    aria-label={t('modelSetup.chooseModel')}
                  >
                    <button
                      type="button"
                      aria-pressed={mode === 'recommended'}
                      onClick={() => chooseMode('recommended')}
                    >
                      {t('modelPolicy.recommended')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={mode === 'manual'}
                      onClick={() => chooseMode('manual')}
                    >
                      {t('modelPolicy.manual')}
                    </button>
                  </fieldset>
                )}
                <p className="model-field-help">{t('modelPolicy.help')}</p>
                {discoveryFailed && (
                  <p className="model-discovery-warning" role="status">
                    {t('modelSetup.discoveryFailed')}
                  </p>
                )}
                {!preset.supportsModelDiscovery && (
                  <p className="model-discovery-warning">
                    {t('modelSetup.discoveryUnavailable')}
                  </p>
                )}
                {preset.supportsModelDiscovery &&
                  !discoveryFailed &&
                  models.length === 0 &&
                  profile.models !== undefined && (
                    <p className="model-discovery-warning">
                      {t('modelSetup.noModels')}
                    </p>
                  )}
                {models.length > 0 && (
                  <>
                    <div className="model-catalog-toolbar">
                      <label>
                        <span className="visually-hidden">
                          {t('modelSetup.modelSearch')}
                        </span>
                        <input
                          type="search"
                          value={modelSearch}
                          placeholder={t('modelSetup.modelSearch')}
                          onChange={(event) =>
                            setModelSearch(event.currentTarget.value)
                          }
                        />
                      </label>
                      <small>
                        {t('modelSetup.modelsFound', { count: models.length })}
                      </small>
                    </div>
                    <fieldset
                      className="model-catalog-list"
                      aria-label={t('modelSetup.chooseModel')}
                    >
                      {filteredModels.map((model) => (
                        <button
                          className="model-catalog-option"
                          key={model.id}
                          type="button"
                          aria-pressed={profile.model === model.id}
                          onClick={() => chooseModel(model.id)}
                        >
                          <span>
                            <strong>{model.name}</strong>
                            <code>{model.id}</code>
                            {model.protocols && (
                              <small className="model-protocol-tags">
                                {model.protocols
                                  .map((protocol) =>
                                    t(PROTOCOL_SHORT_LABELS[protocol]),
                                  )
                                  .join(' · ')}
                              </small>
                            )}
                          </span>
                          {profile.model === model.id && (
                            <SettingsIcon name="check" size={17} />
                          )}
                        </button>
                      ))}
                      {filteredModels.length === 0 && (
                        <p>{t('modelSetup.noSearchResults')}</p>
                      )}
                    </fieldset>
                    {protocolNote && (
                      <p className="model-field-help" role="status">
                        {protocolNote}
                      </p>
                    )}
                  </>
                )}
                {(mode === 'manual' ||
                  discoveryFailed ||
                  models.length === 0) && (
                  <label className="model-draft-field model-id-field">
                    {t('modelSetup.modelId')}
                    <input
                      name="model"
                      value={profile.model ?? ''}
                      aria-invalid={Boolean(errors.model)}
                      aria-describedby={
                        errors.model
                          ? 'model-setup-model-error'
                          : 'model-setup-manual-help'
                      }
                      onChange={(event) =>
                        chooseModel(event.currentTarget.value)
                      }
                    />
                    {fieldError('model')}
                    <small id="model-setup-manual-help">
                      {t('modelSetup.manualHelp')}
                    </small>
                  </label>
                )}
                {profile.model && (
                  <div className="model-selected">
                    <span>{t('modelSetup.selected')}</span>
                    <strong>{selectedModel?.name ?? profile.model}</strong>
                    <code>{profile.model}</code>
                    {mode === 'recommended' && (
                      <span className="model-default-badge">
                        {t('modelSetup.recommended')}
                      </span>
                    )}
                  </div>
                )}
              </section>
            )}

            {keepDraft && (
              <p className="model-draft-note">{t('modelSetup.draftKept')}</p>
            )}
            <div className="model-setup-footer">
              {onBack && (
                <button type="button" onClick={onBack}>
                  {t('modelSetup.back')}
                </button>
              )}
              {settings.providerProfiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    choosePreset('openai');
                    setEditorOpen(false);
                    setFocusField(null);
                  }}
                >
                  {t('modelSetup.cancel')}
                </button>
              )}
              {(!canChooseModel || catalogReady) && (
                <button className="primary-button" type="submit">
                  {busy === 'saving'
                    ? t('modelSetup.saving')
                    : busy === 'testing'
                      ? t('modelSetup.testing')
                      : t('modelSetup.testSave')}
                  <SettingsIcon name="check" size={17} />
                </button>
              )}
            </div>
            {status && (
              <p
                className="model-setup-status model-setup-inline-error"
                ref={formError}
                role="alert"
                tabIndex={-1}
              >
                {status}
              </p>
            )}
          </fieldset>
        </form>
      )}

      {settings.providerProfiles.length > 1 && (
        <details className="model-fallback">
          <summary>{t('modelSetup.fallback')}</summary>
          <p>{t('modelSetup.fallbackHelp')}</p>
          <fieldset disabled={Boolean(busy)}>
            {settings.providerProfiles
              .filter((saved) => saved.id !== settings.activeProviderProfileId)
              .map((saved) => (
                <label key={saved.id}>
                  <input
                    type="checkbox"
                    checked={settings.fallbackProviderProfileIds.includes(
                      saved.id,
                    )}
                    onChange={(event) =>
                      void manageSettings({
                        fallbackProviderProfileIds: event.currentTarget.checked
                          ? [...settings.fallbackProviderProfileIds, saved.id]
                          : settings.fallbackProviderProfileIds.filter(
                              (id) => id !== saved.id,
                            ),
                      })
                    }
                  />
                  <span>{saved.name}</span>
                  {settings.fallbackProviderProfileIds.includes(saved.id) && (
                    <small>
                      {settings.fallbackProviderProfileIds.indexOf(saved.id) +
                        1}
                    </small>
                  )}
                </label>
              ))}
          </fieldset>
        </details>
      )}
      {status && !editorOpen && (
        <p className="model-setup-status" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </div>
  );
}

function normalizeProfile(profile: ProviderProfile): ProviderProfile {
  const normalized = {
    ...profile,
    name: profile.name.trim(),
    ...(profile.endpoint !== undefined
      ? { endpoint: profile.endpoint.trim() }
      : {}),
    ...(profile.model !== undefined ? { model: profile.model.trim() } : {}),
    ...(profile.region !== undefined ? { region: profile.region.trim() } : {}),
    ...(profile.nativeGlossaryId !== undefined
      ? { nativeGlossaryId: profile.nativeGlossaryId.trim() }
      : {}),
  };
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined),
  ) as ProviderProfile;
}

function focusStep(element: HTMLElement | null) {
  if (!element || element.closest('[hidden]')) return;
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({
    block: 'start',
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
  });
}

function safeDiscoveryRequest(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    return `${url.origin}${url.pathname}`;
  } catch {
    return;
  }
}
