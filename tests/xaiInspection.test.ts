import { describe, expect, test } from 'bun:test';

import {
  classifyXaiProbe,
  pickXaiProbeModel,
  resolveProbeOutcome,
} from '../src/utils/xaiInspection';
import {
  computeCachePercent,
  formatCachePercent,
  formatLatencyPair,
  formatTokenTriple,
  flattenUsageEvents,
} from '../src/utils/usageAnalytics';
import type { UsagePayload } from '../src/types/usage';

describe('xAI chat probe classification', () => {
  test('marks unauthorized token as reauth/disabled', () => {
    const result = classifyXaiProbe({
      chatStatus: 401,
      chatError: 'token is expired',
    });
    expect(result.classification).toBe('reauth');
    expect(result.uiStatus).toBe('disabled');
  });

  test('marks free-usage exhausted as limited', () => {
    const result = classifyXaiProbe({
      chatStatus: 429,
      chatCode: 'free-usage-exhausted',
      chatError: 'included free usage exhausted',
    });
    expect(result.classification).toBe('quota_exhausted');
    expect(result.uiStatus).toBe('limited');
  });

  test('marks chat permission denied as error', () => {
    const result = classifyXaiProbe({
      chatStatus: 403,
      chatError: 'chat endpoint is denied',
    });
    expect(result.classification).toBe('permission_denied');
    expect(result.uiStatus).toBe('error');
  });

  test('marks 2xx as healthy', () => {
    const result = classifyXaiProbe({ chatStatus: 200 });
    expect(result.classification).toBe('healthy');
    expect(result.uiStatus).toBe('healthy');
  });

  test('keeps primary reauth when fallback is healthy', () => {
    const primary = classifyXaiProbe({ chatStatus: 401, chatError: 'unauthorized' });
    const fallback = classifyXaiProbe({ chatStatus: 200 });
    const resolved = resolveProbeOutcome(primary, fallback);
    expect(resolved.classification).toBe('reauth');
    expect(resolved.reasonFallback).toContain('备用接口');
  });

  test('picks preferred grok model from models list', () => {
    expect(
      pickXaiProbeModel({
        data: [{ id: 'grok-3-mini' }, { id: 'grok-4.5-build-free' }, { id: 'grok-4' }],
      })
    ).toBe('grok-4.5-build-free');
  });
});

describe('usage recent-row format helpers', () => {
  test('computes cache percent from cached/input tokens', () => {
    expect(computeCachePercent(40, 100)).toBe(40);
    expect(computeCachePercent(0, 0)).toBeNull();
    expect(formatCachePercent(42)).toBe('42%');
    expect(formatCachePercent(null)).toBe('—');
  });

  test('formats token triple and latency pair', () => {
    expect(formatTokenTriple(1200, 340, 1540)).toBe('1.2K / 340 / 1.5K');
    expect(formatLatencyPair(320, 2100)).toBe('320 ms / 2.10s');
    expect(formatLatencyPair(null, 500)).toBe('— / 500 ms');
  });

  test('reads ttft_ms and cache tokens from usage payload', () => {
    const payload: UsagePayload = {
      apis: {
        'POST /v1/responses': {
          models: {
            'grok-4.5': {
              details: [
                {
                  timestamp: '2026-07-14T00:00:00Z',
                  provider: 'xai',
                  latency_ms: 2100,
                  ttft_ms: 320,
                  tokens: {
                    input_tokens: 100,
                    output_tokens: 20,
                    cached_tokens: 40,
                    total_tokens: 120,
                  },
                },
              ],
            },
          },
        },
      },
    };

    const event = flattenUsageEvents(payload)[0];
    expect(event?.ttftMs).toBe(320);
    expect(event?.latencyMs).toBe(2100);
    expect(event?.cachedTokens).toBe(40);
  });
});
