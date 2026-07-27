import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';

import {
  classifyInspectionFailure,
  classifySuccessfulInspection,
} from '../src/features/authFiles/credentialInspection';
import type { AuthFileItem } from '../src/types';

const t = ((key: string) => key) as TFunction;
const file = (overrides: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({ name: 'account.json', type: 'codex', ...overrides }) as AuthFileItem;

describe('credential inspection decisions', () => {
  test('recommends enabling a disabled Codex credential only when both quota windows are usable', () => {
    const result = classifySuccessfulInspection(
      'codex',
      {
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 20 },
          { id: 'weekly', label: 'week', usedPercent: 40 },
        ],
      },
      file({ disabled: true }),
      t
    );

    expect(result.status).toBe('healthy');
    expect(result.action).toBe('enable');
  });

  test('keeps a disabled Codex credential disabled while the five-hour window is exhausted', () => {
    const result = classifySuccessfulInspection(
      'codex',
      {
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 100 },
          { id: 'weekly', label: 'week', usedPercent: 40 },
        ],
      },
      file({ disabled: true }),
      t
    );

    expect(result.status).toBe('limited');
    expect(result.action).toBe('none');
  });

  test('never converts recoverable quota exhaustion into a disabled credential', () => {
    const result = classifySuccessfulInspection(
      'xai',
      {
        billing: {
          mode: 'billing',
          usagePercent: 100,
        },
      },
      file({ type: 'xai', disabled: false }),
      t
    );

    expect(result.status).toBe('limited');
    expect(result.action).toBe('none');
  });

  test('does not restore Codex when long-term quota evidence is missing', () => {
    const result = classifySuccessfulInspection(
      'codex',
      { windows: [{ id: 'five-hour', usedPercent: 10 }] },
      file({ disabled: true }),
      t
    );

    expect(result.status).toBe('review');
    expect(result.action).toBe('review');
  });

  test('offers a combined restore action for a healthy archived and disabled credential', () => {
    const result = classifySuccessfulInspection(
      'claude',
      { windows: [{ id: 'seven-day', usedPercent: 30 }] },
      file({ type: 'claude', disabled: true, archived: true }),
      t
    );

    expect(result.status).toBe('healthy');
    expect(result.action).toBe('restore');
  });

  test('maps invalid credentials to reauthorization', () => {
    const result = classifyInspectionFailure(
      'codex',
      file({ disabled: true }),
      401,
      'invalid or expired credentials',
      t
    );

    expect(result.status).toBe('reauth');
    expect(result.action).toBe('reauth');
  });

  test('does not treat an ambiguous xAI 403 as an invalid credential', () => {
    const result = classifyInspectionFailure(
      'xai',
      file({ type: 'xai' }),
      403,
      'permission denied',
      t
    );

    expect(result.status).toBe('review');
    expect(result.action).toBe('review');
  });

  test('allows disabling xAI only when entitlement denial is explicit', () => {
    const result = classifyInspectionFailure(
      'xai',
      file({ type: 'xai' }),
      403,
      'access to the chat endpoint is denied: subscription required',
      t
    );

    expect(result.status).toBe('review');
    expect(result.action).toBe('disable');
  });

  test('offers delete only for an explicitly deactivated Codex workspace', () => {
    const result = classifyInspectionFailure(
      'codex',
      file({ archived: true }),
      402,
      'deactivated_workspace',
      t
    );

    expect(result.status).toBe('review');
    expect(result.action).toBe('delete');
  });
});
