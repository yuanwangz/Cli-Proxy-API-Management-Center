import { describe, expect, test } from 'bun:test';
import { createSingleFlight } from '@/utils/singleFlight';

describe('createSingleFlight', () => {
  test('shares the pending request and allows a new request after completion', async () => {
    const singleFlight = createSingleFlight<string>();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;

    const first = singleFlight(async () => {
      calls += 1;
      await blocker;
      return 'done';
    });
    const second = singleFlight(async () => {
      calls += 1;
      return 'unexpected';
    });

    expect(second).toBe(first);
    expect(calls).toBe(0);
    release();
    expect(await first).toBe('done');
    expect(calls).toBe(1);

    expect(
      await singleFlight(async () => {
        calls += 1;
        return 'next';
      })
    ).toBe('next');
    expect(calls).toBe(2);
  });

  test('clears the pending request after rejection', async () => {
    const singleFlight = createSingleFlight<void>();
    const failure = new Error('failed');
    let calls = 0;

    const first = singleFlight(async () => {
      calls += 1;
      throw failure;
    });

    await expect(first).rejects.toBe(failure);
    await expect(
      singleFlight(async () => {
        calls += 1;
      })
    ).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
