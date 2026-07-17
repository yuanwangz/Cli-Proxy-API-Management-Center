import { describe, expect, test } from 'bun:test';

import {
  canResetCodexQuota,
  getCodexResetCreditsAvailableCount,
} from '../src/components/quota/quotaConfigs';

describe('Codex non-free reset quota gating', () => {
  test('allows paid plans with available reset credits', () => {
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'plus',
        rateLimitResetCreditsAvailableCount: 2,
      })
    ).toBe(true);
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'pro',
        rateLimitResetCreditsAvailableCount: 1,
      })
    ).toBe(true);
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'team',
        rateLimitResetCreditsAvailableCount: 3,
      })
    ).toBe(true);
  });

  test('rejects free plans even if a credit count is present', () => {
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'free',
        rateLimitResetCreditsAvailableCount: 1,
      })
    ).toBe(false);
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'Free',
        rateLimitResetCreditsAvailableCount: 5,
      })
    ).toBe(false);
  });

  test('rejects missing credits, loading, and error states', () => {
    expect(
      canResetCodexQuota({
        status: 'success',
        planType: 'plus',
        rateLimitResetCreditsAvailableCount: 0,
      })
    ).toBe(false);
    expect(
      canResetCodexQuota({
        status: 'loading',
        planType: 'plus',
        rateLimitResetCreditsAvailableCount: 2,
      })
    ).toBe(false);
    expect(
      canResetCodexQuota({
        status: 'error',
        planType: 'plus',
        rateLimitResetCreditsAvailableCount: 2,
      })
    ).toBe(false);
    expect(canResetCodexQuota(undefined)).toBe(false);
  });

  test('normalizes available credit counts', () => {
    expect(getCodexResetCreditsAvailableCount({ rateLimitResetCreditsAvailableCount: 2.8 })).toBe(
      2
    );
    expect(getCodexResetCreditsAvailableCount({ rateLimitResetCreditsAvailableCount: 0 })).toBe(0);
    expect(getCodexResetCreditsAvailableCount({ rateLimitResetCreditsAvailableCount: null })).toBe(
      0
    );
    expect(getCodexResetCreditsAvailableCount(undefined)).toBe(0);
  });
});
