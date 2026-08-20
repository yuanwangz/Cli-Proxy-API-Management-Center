import { describe, expect, test } from 'bun:test';
import { getQuotaRefreshPlan, nearestQuotaResetMs } from '@/utils/quotaRefreshSchedule';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');

const snapshot = (
  quota: unknown,
  refreshedAtMs = NOW
): Parameters<typeof getQuotaRefreshPlan>[0] => ({
  provider: 'claude',
  auth_index: 'auth-1',
  quota,
  refreshed_at_ms: refreshedAtMs,
});

describe('quota refresh schedule', () => {
  test('schedules the next provider reset from a successful snapshot', () => {
    const resetAtMs = NOW + 3 * 60 * 60 * 1000;
    expect(
      getQuotaRefreshPlan(snapshot({ status: 'success', windows: [{ resetAtMs }] }), NOW)
    ).toEqual({ refreshAtMs: resetAtMs, resetAtMs });
  });

  test('refreshes immediately when a reset passed after the snapshot was captured', () => {
    const resetAtMs = NOW - 60 * 60 * 1000;
    expect(
      getQuotaRefreshPlan(
        snapshot({ status: 'success', windows: [{ resetAtMs }] }, NOW - 2 * 60 * 60 * 1000),
        NOW
      )
    ).toEqual({ refreshAtMs: NOW, resetAtMs });
  });

  test('does not re-trigger a reset already covered by the latest snapshot', () => {
    const resetAtMs = NOW - 60 * 60 * 1000;
    expect(
      getQuotaRefreshPlan(snapshot({ status: 'success', windows: [{ resetAtMs }] }), NOW)
    ).toBeNull();
  });

  test('prefers an expired window that was missed over a later window', () => {
    const expiredResetAtMs = NOW - 60 * 60 * 1000;
    const futureResetAtMs = NOW + 3 * 60 * 60 * 1000;
    expect(
      getQuotaRefreshPlan(
        snapshot(
          {
            status: 'success',
            windows: [{ resetAtMs: expiredResetAtMs }, { resetAtMs: futureResetAtMs }],
          },
          NOW - 2 * 60 * 60 * 1000
        ),
        NOW
      )
    ).toEqual({ refreshAtMs: NOW, resetAtMs: expiredResetAtMs });
  });

  test('reads Gemini reset times and Codex reset-credit expirations', () => {
    const geminiResetAtMs = NOW + 60 * 60 * 1000;
    expect(
      nearestQuotaResetMs(
        { status: 'success', buckets: [{ resetTime: new Date(geminiResetAtMs).toISOString() }] },
        NOW
      )
    ).toBe(geminiResetAtMs);

    const codexResetAtMs = NOW + 2 * 60 * 60 * 1000;
    expect(
      nearestQuotaResetMs(
        {
          status: 'success',
          rateLimitResetCredits: [
            { status: 'available', expiresAt: new Date(codexResetAtMs).toISOString() },
          ],
        },
        NOW
      )
    ).toBe(codexResetAtMs);
  });

  test('normalizes provider aliases and only schedules xAI weekly capacity resets', () => {
    const weeklyResetAtMs = NOW + 90 * 60 * 1000;
    const weeklyQuota = {
      status: 'success',
      billing: { periodType: 'weekly', resetAtMs: weeklyResetAtMs },
    };
    expect(
      getQuotaRefreshPlan(
        {
          ...snapshot(weeklyQuota),
          provider: 'x-ai',
        },
        NOW
      )
    ).toEqual({ refreshAtMs: weeklyResetAtMs, resetAtMs: weeklyResetAtMs });
    expect(nearestQuotaResetMs(weeklyQuota, NOW, 'grok')).toBe(weeklyResetAtMs);

    expect(
      getQuotaRefreshPlan(
        {
          ...snapshot({
            status: 'success',
            billing: { periodType: 'monthly', resetAtMs: weeklyResetAtMs },
          }),
          provider: 'grok',
        },
        NOW
      )
    ).toBeNull();
  });

  test('ignores unloaded or errored snapshots', () => {
    expect(getQuotaRefreshPlan(snapshot({ status: 'loading' }), NOW)).toBeNull();
    expect(getQuotaRefreshPlan(snapshot({ status: 'error' }), NOW)).toBeNull();
    expect(getQuotaRefreshPlan(snapshot({ status: 'success' }), NOW)).toBeNull();
  });
});
