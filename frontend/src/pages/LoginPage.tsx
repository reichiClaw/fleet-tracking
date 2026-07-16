import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { AUTH_CONTINUATION_KEY } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { DEMO_AUTH_ENABLED, type UserRole, useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { LanguageSelector } from '../components/LanguageSelector';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operations');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stateFrom = (location.state as { from?: string | { pathname?: string; search?: string; hash?: string } } | null)?.from;
  const stateTarget =
    typeof stateFrom === 'string'
      ? stateFrom
      : stateFrom
        ? `${stateFrom.pathname ?? ''}${stateFrom.search ?? ''}${stateFrom.hash ?? ''}`
        : '';
  const storedTarget = window.sessionStorage.getItem(AUTH_CONTINUATION_KEY) ?? '';
  const candidate = stateTarget || storedTarget;
  const from = candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/login')
    ? candidate
    : '/app';

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError(t('auth.login.validation.usernameRequired'));
      return;
    }

    if (!password) {
      setError(t('auth.login.validation.passwordRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        username: username.trim(),
        password,
        fallbackUser: { name: username.trim(), username: username.trim(), role, isBackendSession: false },
      });
      window.sessionStorage.removeItem(AUTH_CONTINUATION_KEY);
      navigate(from, { replace: true });
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('auth.login.error')));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-card__header">
          <div>
            <p className="eyebrow">{t('app.subtitle')}</p>
            <h1>{t('auth.login.title')}</h1>
          </div>
          <LanguageSelector />
        </div>
        <p>{t(DEMO_AUTH_ENABLED ? 'auth.login.intro' : 'auth.login.introProduction')}</p>

        {error ? <ErrorState message={error} /> : null}

        <form className="form-stack" onSubmit={handleSubmit}>
          <label>
            <span>{t('auth.login.usernameLabel')}</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t('auth.login.usernamePlaceholder')}
            />
          </label>

          <label>
            <span>{t('auth.login.passwordLabel')}</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('auth.login.passwordPlaceholder')}
            />
          </label>

          {DEMO_AUTH_ENABLED ? (
            <label>
              <span>{t('auth.login.roleLabel')}</span>
              <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
                <option value="operations">{t('roles.operations')}</option>
                <option value="admin">{t('roles.admin')}</option>
                <option value="readonly">{t('roles.readonly')}</option>
              </select>
            </label>
          ) : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </button>
        </form>

        {DEMO_AUTH_ENABLED ? <p className="hint-text">{t('auth.login.demoHint')}</p> : null}
      </section>
    </main>
  );
}
