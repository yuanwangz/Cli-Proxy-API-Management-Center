import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  buildAuthFilesBatchPatch,
  createAuthFilesBatchEditDraft,
  type AuthFilesBatchEditDraft,
  type AuthFilesBatchEditField,
} from '@/features/authFiles/batchEdit';
import {
  normalizeProviderKey,
  supportsAuthFileUsingApi,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/constants';
import type { AuthFileFieldsPatch } from '@/services/api';
import type { AuthFileItem } from '@/types';
import styles from './AuthFilesBatchEditorModal.module.scss';

export type AuthFilesBatchEditorModalProps = {
  open: boolean;
  files: AuthFileItem[];
  saving: boolean;
  disableControls: boolean;
  onClose: () => void;
  onSubmit: (patch: AuthFileFieldsPatch, fieldCount: number) => void;
};

type BatchEditFieldRowProps = {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
  children: ReactNode;
};

function BatchEditFieldRow(props: BatchEditFieldRowProps) {
  const { checked, disabled, label, onToggle, children } = props;
  return (
    <div className={`${styles.fieldRow} ${checked ? styles.fieldRowEnabled : ''}`}>
      <label className={styles.fieldOptIn}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} />
        <span>{label}</span>
      </label>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

export function AuthFilesBatchEditorModal(props: AuthFilesBatchEditorModalProps) {
  const { t } = useTranslation();
  const { open, files, saving, disableControls, onClose, onSubmit } = props;
  const [draft, setDraft] = useState<AuthFilesBatchEditDraft>(createAuthFilesBatchEditDraft);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(createAuthFilesBatchEditDraft());
    setError('');
  }, [open]);

  const providerKeys = useMemo(
    () => files.map((file) => normalizeProviderKey(String(file.type ?? file.provider ?? ''))),
    [files]
  );
  const showWebsockets = providerKeys.length > 0 && providerKeys.every(supportsAuthFileWebsockets);
  const showUsingApi = providerKeys.length > 0 && providerKeys.every(supportsAuthFileUsingApi);
  const fieldsDisabled = disableControls || saving;

  const toggleField = (field: AuthFilesBatchEditField) => {
    setError('');
    setDraft((current) => ({
      ...current,
      enabled: { ...current.enabled, [field]: !current.enabled[field] },
    }));
  };

  const updateDraft = <Key extends keyof AuthFilesBatchEditDraft>(
    key: Key,
    value: AuthFilesBatchEditDraft[Key]
  ) => {
    setError('');
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    const result = buildAuthFilesBatchPatch(draft);
    if (result.error) {
      setError(t(`auth_files.${result.error}`));
      return;
    }
    onSubmit(result.patch, result.fieldCount);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={saving}
      width={720}
      title={t('auth_files.batch_edit_title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={saving}
            disabled={disableControls || saving || files.length === 0}
          >
            {t('auth_files.batch_edit_review')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <div className={styles.scope}>
          <strong>{t('auth_files.batch_edit_scope', { count: files.length })}</strong>
          <span>{t('auth_files.batch_edit_opt_in_hint')}</span>
        </div>

        <div className={styles.fields}>
          <BatchEditFieldRow
            checked={draft.enabled.priority}
            disabled={fieldsDisabled}
            label={t('auth_files.priority_label')}
            onToggle={() => toggleField('priority')}
          >
            <Input
              value={draft.priority}
              inputMode="numeric"
              placeholder={t('auth_files.priority_placeholder')}
              disabled={fieldsDisabled || !draft.enabled.priority}
              onChange={(event) => updateDraft('priority', event.target.value)}
            />
          </BatchEditFieldRow>

          <BatchEditFieldRow
            checked={draft.enabled.note}
            disabled={fieldsDisabled}
            label={t('auth_files.note_label')}
            onToggle={() => toggleField('note')}
          >
            <Input
              value={draft.note}
              maxLength={2000}
              placeholder={t('auth_files.note_placeholder')}
              disabled={fieldsDisabled || !draft.enabled.note}
              onChange={(event) => updateDraft('note', event.target.value)}
            />
          </BatchEditFieldRow>

          <BatchEditFieldRow
            checked={draft.enabled.prefix}
            disabled={fieldsDisabled}
            label={t('auth_files.prefix_label')}
            onToggle={() => toggleField('prefix')}
          >
            <Input
              value={draft.prefix}
              maxLength={256}
              disabled={fieldsDisabled || !draft.enabled.prefix}
              onChange={(event) => updateDraft('prefix', event.target.value)}
            />
          </BatchEditFieldRow>

          <BatchEditFieldRow
            checked={draft.enabled.proxyUrl}
            disabled={fieldsDisabled}
            label={t('auth_files.proxy_url_label')}
            onToggle={() => toggleField('proxyUrl')}
          >
            <Input
              value={draft.proxyUrl}
              placeholder={t('auth_files.proxy_url_placeholder')}
              disabled={fieldsDisabled || !draft.enabled.proxyUrl}
              onChange={(event) => updateDraft('proxyUrl', event.target.value)}
            />
          </BatchEditFieldRow>

          {showWebsockets ? (
            <BatchEditFieldRow
              checked={draft.enabled.websockets}
              disabled={fieldsDisabled}
              label={t('auth_files.websockets_label')}
              onToggle={() => toggleField('websockets')}
            >
              <div className={styles.switchControl}>
                <ToggleSwitch
                  checked={draft.websockets}
                  disabled={fieldsDisabled || !draft.enabled.websockets}
                  ariaLabel={t('auth_files.websockets_label')}
                  onChange={(value) => updateDraft('websockets', value)}
                />
                <span>
                  {t(
                    draft.websockets
                      ? 'auth_files.batch_edit_switch_on'
                      : 'auth_files.batch_edit_switch_off'
                  )}
                </span>
              </div>
            </BatchEditFieldRow>
          ) : null}

          {showUsingApi ? (
            <BatchEditFieldRow
              checked={draft.enabled.usingApi}
              disabled={fieldsDisabled}
              label={t('auth_files.using_api_label')}
              onToggle={() => toggleField('usingApi')}
            >
              <div className={styles.switchControl}>
                <ToggleSwitch
                  checked={draft.usingApi}
                  disabled={fieldsDisabled || !draft.enabled.usingApi}
                  ariaLabel={t('auth_files.using_api_label')}
                  onChange={(value) => updateDraft('usingApi', value)}
                />
                <span>
                  {t(
                    draft.usingApi
                      ? 'auth_files.batch_edit_switch_on'
                      : 'auth_files.batch_edit_switch_off'
                  )}
                </span>
              </div>
            </BatchEditFieldRow>
          ) : null}

          <BatchEditFieldRow
            checked={draft.enabled.headers}
            disabled={fieldsDisabled}
            label={t('auth_files.headers_label')}
            onToggle={() => toggleField('headers')}
          >
            <div className={styles.headersControl}>
              <textarea
                className="input"
                rows={5}
                value={draft.headersText}
                placeholder={t('auth_files.batch_edit_headers_placeholder')}
                disabled={fieldsDisabled || !draft.enabled.headers}
                onChange={(event) => updateDraft('headersText', event.target.value)}
              />
              <span>{t('auth_files.batch_edit_headers_hint')}</span>
            </div>
          </BatchEditFieldRow>
        </div>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
