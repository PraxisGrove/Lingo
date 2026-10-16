import { useInterfaceTranslation } from '@/lib/i18n/i18n';
import {
  forbiddenHeaderName,
  MAX_CUSTOM_HEADERS,
} from '@/lib/providers/request-options';
import type { ProviderProfile } from '@/lib/storage/settings-model';

export type HeaderDraft = {
  name: string;
  value: string;
  secret: boolean;
  /** A secret value is already saved; leaving the field empty keeps it. */
  stored?: boolean;
};

const SECRET_NAME = /auth|key|token|secret|sig|password|cookie/i;
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export function headerDraftsFor(profile: ProviderProfile): HeaderDraft[] {
  return (profile.headers ?? []).map((header) =>
    header.value === undefined
      ? { name: header.name, value: '', secret: true, stored: true }
      : { name: header.name, value: header.value, secret: false },
  );
}

export function headerDraftError(draft: HeaderDraft): boolean {
  const name = draft.name.trim();
  return (
    Boolean(name || draft.value) &&
    (!HEADER_NAME.test(name) || forbiddenHeaderName(name))
  );
}

/** Split rows into settings headers and secret values sent only to storage. */
export function splitHeaderDrafts(drafts: HeaderDraft[]): {
  headers: NonNullable<ProviderProfile['headers']>;
  secrets: Record<string, string>;
} {
  const headers: NonNullable<ProviderProfile['headers']> = [];
  const secrets: Record<string, string> = {};
  for (const draft of drafts) {
    const name = draft.name.trim();
    if (!name || headerDraftError(draft)) continue;
    if (draft.secret) {
      if (!draft.value && !draft.stored) continue;
      headers.push({ name });
      if (draft.value) secrets[name] = draft.value;
    } else if (draft.value) headers.push({ name, value: draft.value });
  }
  return { headers, secrets };
}

export default function GatewayHeaders({
  drafts,
  onChange,
}: {
  drafts: HeaderDraft[];
  onChange(next: HeaderDraft[]): void;
}) {
  const { t } = useInterfaceTranslation();
  const update = (index: number, patch: Partial<HeaderDraft>) =>
    onChange(
      drafts.map((draft, position) => {
        if (position !== index) return draft;
        const next = { ...draft, ...patch };
        if (patch.name !== undefined && SECRET_NAME.test(patch.name))
          next.secret = true;
        if (patch.secret === false || patch.name !== undefined)
          next.stored = next.secret ? draft.stored : false;
        return next;
      }),
    );
  return (
    <fieldset className="model-headers">
      <legend>{t('modelSetup.headers.title')}</legend>
      <p className="model-field-help">{t('modelSetup.headers.help')}</p>
      {drafts.map((draft, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id while names are edited.
        <div className="model-header-row" key={index}>
          <input
            name={`header-name-${index}`}
            aria-label={t('modelSetup.headers.name')}
            placeholder={t('modelSetup.headers.name')}
            spellCheck={false}
            autoComplete="off"
            value={draft.name}
            aria-invalid={headerDraftError(draft)}
            onChange={(event) =>
              update(index, { name: event.currentTarget.value })
            }
          />
          <input
            name={`header-value-${index}`}
            aria-label={t('modelSetup.headers.value')}
            placeholder={t(
              draft.stored
                ? 'modelSetup.headers.keep'
                : 'modelSetup.headers.value',
            )}
            type={draft.secret ? 'password' : 'text'}
            spellCheck={false}
            autoComplete="off"
            value={draft.value}
            onChange={(event) =>
              update(index, { value: event.currentTarget.value })
            }
          />
          <label>
            <input
              type="checkbox"
              checked={draft.secret}
              onChange={(event) =>
                update(index, { secret: event.currentTarget.checked })
              }
            />
            {t('modelSetup.headers.secret')}
          </label>
          <button
            type="button"
            className="text-button"
            aria-label={t('modelSetup.headers.remove', {
              name: draft.name || index + 1,
            })}
            onClick={() =>
              onChange(drafts.filter((_, position) => position !== index))
            }
          >
            ×
          </button>
          {headerDraftError(draft) && (
            <small className="model-field-error">
              {t('modelSetup.headers.invalid')}
            </small>
          )}
        </div>
      ))}
      {drafts.length < MAX_CUSTOM_HEADERS && (
        <button
          type="button"
          className="model-add-header"
          onClick={() =>
            onChange([...drafts, { name: '', value: '', secret: false }])
          }
        >
          + {t('modelSetup.headers.add')}
        </button>
      )}
    </fieldset>
  );
}
