import { describe, expect, it } from 'vitest';
import {
  forbiddenHeaderName,
  joinEndpoint,
  resolveCustomHeaders,
  secretQueryParameter,
} from './request-options';

describe('custom request options', () => {
  it('appends API paths while keeping a gateway query string', () => {
    expect(
      joinEndpoint(
        'https://r.openai.azure.com/openai/deployments/gpt?api-version=2024-10-21',
        'chat/completions',
      ),
    ).toBe(
      'https://r.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21',
    );
    expect(joinEndpoint('https://api.example/v1/', '/models')).toBe(
      'https://api.example/v1/models',
    );
  });

  it.each([
    'authorization',
    'Cookie',
    'host',
    'Content-Type',
    'x-api-key',
    'api-key',
    'Sec-Fetch-Mode',
    'proxy-authorization',
    'ocp-apim-subscription-key',
  ])('reserves the %s header', (name) => {
    expect(forbiddenHeaderName(name)).toBe(true);
  });

  it('accepts gateway headers and drops invalid or duplicate entries', () => {
    expect(
      resolveCustomHeaders([
        { name: 'X-Portkey-Config', value: 'cfg' },
        { name: 'cf-aig-authorization' },
        { name: 'x-portkey-config', value: 'duplicate' },
        { name: 'Authorization', value: 'Bearer x' },
        { name: 'bad name', value: 'x' },
        { name: 'X-Line', value: 'a\r\nb' },
        'junk',
      ]),
    ).toEqual([
      { name: 'X-Portkey-Config', value: 'cfg' },
      { name: 'cf-aig-authorization' },
    ]);
  });

  it('flags query parameters that would place a secret in settings', () => {
    expect(secretQueryParameter('https://a.example/v1?api-version=1')).toBe(
      undefined,
    );
    expect(secretQueryParameter('https://a.example/v1?key=abc')).toBe('key');
    expect(secretQueryParameter('https://a.example/v1?sig=abc')).toBe('sig');
  });
});
