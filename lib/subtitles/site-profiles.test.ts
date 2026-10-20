import { describe, expect, it } from 'vitest';
import { profileForHost } from './site-profiles';

describe('subtitle site profiles', () => {
  it.each([
    ['www.youtube.com', 'youtube'],
    ['m.youtube.com', 'youtube'],
    ['www.youtube-nocookie.com', 'youtube'],
    ['www.bilibili.com', 'bilibili'],
    ['www.netflix.com', 'netflix'],
    ['www.primevideo.com', 'prime-video'],
    ['www.amazon.co.jp', 'prime-video'],
    ['vimeo.com', 'vimeo'],
    ['player.vimeo.com', 'vimeo'],
    ['notyoutube.com', 'generic'],
    ['amazon.example.org', 'generic'],
    ['example.com', 'generic'],
  ])('maps %s to %s', (host, id) => {
    expect(profileForHost(host).id).toBe(id);
  });
});
