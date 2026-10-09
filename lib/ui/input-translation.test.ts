// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureInput } from './input-translation';

afterEach(() => {
  document.body.innerHTML = '';
});
describe('explicit input translation', () => {
  it('confirms replacement, dispatches input, and safely restores the original', () => {
    document.body.innerHTML = '<textarea>Hello</textarea>';
    const field = document.querySelector('textarea');
    if (!field) throw new Error('Missing field');
    const listener = vi.fn();
    field.addEventListener('input', listener);
    const captured = captureInput(field);
    expect(captured?.apply('你好')).toBe(true);
    expect(field.value).toBe('你好');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(captured?.undo()).toBe(true);
    expect(field.value).toBe('Hello');
  });

  it('refuses a late replacement and undo after further editing', () => {
    document.body.innerHTML = '<input value="Hello">';
    const field = document.querySelector('input');
    if (!field) throw new Error('Missing field');
    const stale = captureInput(field);
    field.value = 'User edit';
    expect(stale?.apply('Translation')).toBe(false);
    const current = captureInput(field);
    expect(current?.apply('Translation')).toBe(true);
    field.value = 'Another edit';
    expect(current?.undo()).toBe(false);
    expect(field.value).toBe('Another edit');
  });

  it.each([
    '<input type="password" value="secret">',
    '<input autocomplete="cc-number" value="secret">',
    '<input name="cvv" value="secret">',
    '<input readonly value="secret">',
    '<input type="email" value="secret">',
    '<div translate="no"><input value="secret"></div>',
  ])('rejects protected fields: %s', (html) => {
    document.body.innerHTML = html;
    expect(captureInput(document.querySelector('input'))).toBeUndefined();
  });
});
