import { describe, expect, test } from 'vitest';
import { compareVersions, parseFirmwareVersion, safeCompareVersions } from './firmware';

describe('parseFirmwareVersion', () => {
  test('parses stable version', () => {
    expect(parseFirmwareVersion('2.0.12')).toEqual({
      major: 2,
      minor: 0,
      patch: 12,
      preRelease: null,
      preReleaseNumber: null,
    });
  });

  test('parses alpha version', () => {
    expect(parseFirmwareVersion('2.0.0alpha3')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      preRelease: 'alpha',
      preReleaseNumber: 3,
    });
  });

  test('parses beta version', () => {
    expect(parseFirmwareVersion('2.0.0beta12')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      preRelease: 'beta',
      preReleaseNumber: 12,
    });
  });

  test('parses RC version', () => {
    expect(parseFirmwareVersion('2.0.0RC2')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      preRelease: 'RC',
      preReleaseNumber: 2,
    });
  });

  test('parses dev version', () => {
    expect(parseFirmwareVersion('2.0-dev')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      preRelease: 'dev',
      preReleaseNumber: 0,
    });
  });

  test('throws on invalid version', () => {
    expect(() => parseFirmwareVersion('2.0.0-foo')).toThrowError(
      'Invalid firmware version: 2.0.0-foo',
    );
  });

  test('throws on invalid version', () => {
    expect(() => parseFirmwareVersion('2.0.0RC')).toThrowError('Invalid firmware version: 2.0.0RC');
  });
});

describe('compareVersions', () => {
  test('compares stable versions', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.0', '2.0.1')).toBe(-1);
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '2.1.0')).toBe(-1);
    expect(compareVersions('2.1.0', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '3.0.0')).toBe(-1);
    expect(compareVersions('3.0.0', '2.0.0')).toBe(1);
  });

  test('compares alpha and beta versions', () => {
    expect(compareVersions('2.0.0alpha1', '2.0.0alpha1')).toBe(0);
    expect(compareVersions('2.0.0alpha1', '2.0.0alpha2')).toBe(-1);
    expect(compareVersions('2.0.0alpha2', '2.0.0alpha1')).toBe(1);
    expect(compareVersions('2.0.0alpha1', '2.0.0beta1')).toBe(-1);
    expect(compareVersions('2.0.0beta1', '2.0.0alpha1')).toBe(1);
    expect(compareVersions('2.0.0beta1', '2.0.0alpha99')).toBe(1);
  });

  test('compare alpha and RC versions', () => {
    expect(compareVersions('2.0.0RC1', '2.0.0RC1')).toBe(0);
    expect(compareVersions('2.0.0RC1', '2.0.0RC2')).toBe(-1);
    expect(compareVersions('2.0.0RC2', '2.0.0RC1')).toBe(1);
    expect(compareVersions('2.0.0alpha3', '2.0.0RC1')).toBe(-1);
    expect(compareVersions('2.0.0RC1', '2.0.0alpha3')).toBe(1);
  });

  test('compares beta and RC versions', () => {
    expect(compareVersions('2.0.0beta1', '2.0.0beta1')).toBe(0);
    expect(compareVersions('2.0.0beta1', '2.0.0beta2')).toBe(-1);
    expect(compareVersions('2.0.0beta2', '2.0.0beta1')).toBe(1);
    expect(compareVersions('2.0.0beta0', '2.0.0RC1')).toBe(-1);
    expect(compareVersions('2.0.0beta9', '2.0.0RC1')).toBe(-1);
    expect(compareVersions('2.0.0RC1', '2.0.0beta9')).toBe(1);
  });

  test('compare alpha, beta, RC with stable versions', () => {
    expect(compareVersions('2.0.0', '2.0.0alpha1')).toBe(1);
    expect(compareVersions('2.0.0alpha1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0beta1')).toBe(1);
    expect(compareVersions('2.0.0beta1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0RC1')).toBe(1);
    expect(compareVersions('2.0.0RC1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.1alpha1')).toBe(-1);
    expect(compareVersions('2.0.1alpha1', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '2.0.1beta1')).toBe(-1);
    expect(compareVersions('2.0.1beta1', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.0', '2.0.1RC1')).toBe(-1);
    expect(compareVersions('2.0.1RC1', '2.0.0')).toBe(1);
  });

  test('compare dev versions', () => {
    expect(compareVersions('2.0-dev', '2.0-dev')).toBe(0);
    expect(compareVersions('2.0-dev', '2.0.1')).toBe(1);
    expect(compareVersions('2.0-dev', '2.1.0')).toBe(-1);
    expect(compareVersions('2.1-dev', '2.0-dev')).toBe(1);
  });
});

describe('safeCompareVersions', () => {
  test('treats an unparseable version as 0.0.0 instead of throwing', () => {
    expect(safeCompareVersions('unknown', '2.0.4')).toBeLessThan(0);
    expect(safeCompareVersions('2.0.4', 'unknown')).toBeGreaterThan(0);
    expect(safeCompareVersions('2.0.4', '2.0.4')).toBe(0);
  });

  test('compares two parseable versions exactly like compareVersions', () => {
    expect(safeCompareVersions('2.0.0RC1', '2.0.0')).toBe(compareVersions('2.0.0RC1', '2.0.0'));
    expect(safeCompareVersions('3.1.0', '2.0.4')).toBe(compareVersions('3.1.0', '2.0.4'));
  });

  test('two unparseable versions compare equal', () => {
    expect(safeCompareVersions('unknown', 'garbage')).toBe(0);
  });
});
