import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { setUserPassword } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mandatory = user?.mustChangePassword || Boolean((location.state as { mandatory?: boolean } | null)?.mandatory);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  useDirtyFormWarning(Boolean(currentPassword || newPassword || confirmation) && !success, t('forms.unsaved'));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (newPassword.length < 8) {
      setError(t('password.validation.length'));
      return;
    }
    if (newPassword !== confirmation) {
      setError(t('password.validation.match'));
      return;
    }
    if (!user?.id) {
      setError(t('password.backendRequired'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await setUserPassword(user.id, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSuccess(true);
      await refreshUser();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('password.saveError')));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('password.eyebrow')}
        title={t('password.title')}
        description={mandatory ? t('password.mandatory') : t('password.description')}
      />
      {mandatory && !success ? <p className="warning-panel" role="alert">{t('password.mandatoryNotice')}</p> : null}
      {error ? <ErrorState message={error} /> : null}
      {success ? (
        <section className="success-panel" role="status" aria-live="polite">
          <p>{t('password.success')}</p>
          <button type="button" onClick={() => navigate('/app', { replace: true })}>{t('password.continue')}</button>
        </section>
      ) : (
        <form className="content-card form-stack narrow-form" onSubmit={submit}>
          <Field label={t('password.current')} required>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label={t('password.new')} hint={t('password.hint')} required>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </Field>
          <Field label={t('password.confirm')} required>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </Field>
          <button type="submit" className="success-button" disabled={pending}>
            {pending ? t('common.pending') : t('password.submit')}
          </button>
        </form>
      )}
    </section>
  );
}
