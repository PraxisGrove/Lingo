import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings-model';
import { createDiagnosticReport } from './diagnostics';

describe('createDiagnosticReport', () => {
  it('exports useful runtime state without provider or translation secrets', () => {
    const report = createDiagnosticReport({
      extensionVersion: '1.2.3',
      generatedAt: '2026-07-14T00:00:00.000Z',
      hostPermissionGranted: true,
      cache: { entryCount: 4, byteSize: 1024 },
      settings: {
        ...DEFAULT_SETTINGS,
        providerProfiles: [
          {
            id: 'private-profile-id',
            name: 'Private work endpoint',
            provider: 'openai-compatible',
            endpoint: 'https://secret.example/v1',
            model: 'confidential-model',
          },
        ],
        activeProviderProfileId: 'private-profile-id',
        translationQuality: {
          ...DEFAULT_SETTINGS.translationQuality,
          instruction: 'Confidential instruction',
          glossary: [{ source: 'Secret', target: 'Classified' }],
        },
      },
    });

    expect(report).toMatchObject({
      extensionVersion: '1.2.3',
      generatedAt: '2026-07-14T00:00:00.000Z',
      hostPermissionGranted: true,
      configuredProviderKinds: ['openai-compatible'],
      configuredProviderCount: 1,
      cache: { enabled: true, entryCount: 4, byteSize: 1024 },
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private|secret\.example|confidential|classified/i,
    );
  });
});
