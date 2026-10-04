import { describe, expect, it } from 'vitest';

import { shouldShowIosHint, type IosHintEnvironment } from '../src/ui/iosHint';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

function env(overrides: Partial<IosHintEnvironment>): IosHintEnvironment {
  return {
    userAgent: IPHONE_SAFARI,
    maxTouchPoints: 5,
    standalone: false,
    displayModeStandalone: false,
    ...overrides,
  };
}

describe('shouldShowIosHint', () => {
  it('shows on iOS Safari outside standalone mode', () => {
    expect(shouldShowIosHint(env({}))).toBe(true);
  });

  it('stays hidden when launched from the home screen', () => {
    expect(shouldShowIosHint(env({ standalone: true }))).toBe(false);
    expect(shouldShowIosHint(env({ displayModeStandalone: true }))).toBe(false);
  });

  it('stays hidden in other iOS browsers', () => {
    expect(shouldShowIosHint(env({ userAgent: CHROME_IOS }))).toBe(false);
  });

  it('stays hidden on desktop Safari', () => {
    expect(shouldShowIosHint(env({ userAgent: MAC_SAFARI, maxTouchPoints: 0 }))).toBe(false);
  });

  it('shows on iPadOS Safari that reports a desktop user agent', () => {
    expect(shouldShowIosHint(env({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5 }))).toBe(true);
  });

  it('stays hidden on Android', () => {
    expect(shouldShowIosHint(env({ userAgent: ANDROID }))).toBe(false);
  });
});
