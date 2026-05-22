import { describe, it, expect } from 'vitest';
import { parseConfig, DEFAULT_CONFIG, MAX_ROTATE_SECONDS, MIN_ROTATE_SECONDS } from './config';

describe('parseConfig', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('')).toEqual(DEFAULT_CONFIG);
  });

  it('returns the defaults for non-JSON or non-object junk', () => {
    expect(parseConfig('not json')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('42')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('null')).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a fully valid config', () => {
    const cfg = {
      disabledViewIds: ['clock'],
      density: 2,
      autoRotate: true,
      rotateSeconds: 15,
    };
    expect(parseConfig(JSON.stringify(cfg))).toEqual(cfg);
  });

  it('falls back per-field, keeping the valid keys', () => {
    const parsed = parseConfig(
      JSON.stringify({ density: 'huge', autoRotate: true, rotateSeconds: 'soon' }),
    );
    expect(parsed.density).toBe('auto'); // invalid → default
    expect(parsed.autoRotate).toBe(true); // valid → kept
    expect(parsed.rotateSeconds).toBe(DEFAULT_CONFIG.rotateSeconds); // invalid → default
  });

  it('drops non-string entries from disabledViewIds', () => {
    expect(parseConfig(JSON.stringify({ disabledViewIds: ['clock', 7, null] })).disabledViewIds).toEqual(
      ['clock'],
    );
    expect(parseConfig(JSON.stringify({ disabledViewIds: 'clock' })).disabledViewIds).toEqual([]);
  });

  it('clamps and rounds rotateSeconds into range', () => {
    expect(parseConfig(JSON.stringify({ rotateSeconds: 0 })).rotateSeconds).toBe(MIN_ROTATE_SECONDS);
    expect(parseConfig(JSON.stringify({ rotateSeconds: 9999 })).rotateSeconds).toBe(
      MAX_ROTATE_SECONDS,
    );
    expect(parseConfig(JSON.stringify({ rotateSeconds: 10.7 })).rotateSeconds).toBe(11);
  });
});
