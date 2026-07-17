import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  createUser,
  deactivateUser,
  listUsers,
  setTemporaryUserPassword,
  updateUser,
  type ManagedUser,
  type UserRole,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadingState } from '../components/LoadingState';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';
import { formatDateTime } from '../utils/format';

const ROLES: UserRole[] = ['admin', 'operations', 'readonly'];

export function UserManagementPage() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const { user: currentUser } = useAuth();
  const [params] = useSearchParams();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('operations');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(params.get('status') === 'attention' ? 'attention' : '');
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState<{ username: string; password: string } | null>(null);
  const [confirmChange, setConfirmChange] = useState<
    { type: 'role'; user: ManagedUser; role: UserRole } | { type: 'active'; user: ManagedUser } | null
  >(null);
  useDirtyFormWarning(Boolean(username || fullName || email || password), t('forms.unsaved'));

  async function loadUsers() {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('users.loadError')));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setNotice(null);
    if (!username.trim()) {
      setError(t('users.validation.usernameRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('users.validation.passwordRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createUser({
        username: username.trim(),
        full_name: fullName.trim(),
        email: email.trim(),
        role,
        password,
      });
      setOneTimePassword({ username: username.trim(), password });
      setUsername('');
      setFullName('');
      setEmail('');
      setRole('operations');
      setPassword('');
      setNotice(t('users.created'));
      await loadUsers();
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('users.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runUpdate(id: string, action: () => Promise<unknown>, success: string) {
    setPendingId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      await loadUsers();
      return true;
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('users.saveError')));
      return false;
    } finally {
      setPendingId(null);
    }
  }

  function handleRoleChange(target: ManagedUser, nextRole: UserRole) {
    if (nextRole === target.role) {
      return;
    }
    setConfirmChange({ type: 'role', user: target, role: nextRole });
  }

  function handleToggleActive(target: ManagedUser) {
    setConfirmChange({ type: 'active', user: target });
  }

  function confirmUpdate() {
    if (!confirmChange) return;
    const change = confirmChange;
    setConfirmChange(null);
    if (change.type === 'role') {
      void runUpdate(change.user.id, () => updateUser(change.user.id, { role: change.role }), t('users.roleUpdated'));
    } else {
      void runUpdate(
        change.user.id,
        () => change.user.is_active ? deactivateUser(change.user.id) : updateUser(change.user.id, { is_active: true }),
        t(change.user.is_active ? 'users.deactivated' : 'users.activated'),
      );
    }
  }

  function beginReset(target: ManagedUser) {
    setResetUser(target);
    setTemporaryPassword(generateTemporaryPassword());
    setOneTimePassword(null);
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser || temporaryPassword.length < 8 || pendingId) return;
    const passwordToShow = temporaryPassword;
    const succeeded = await runUpdate(
      resetUser.id,
      () => setTemporaryUserPassword(resetUser.id, passwordToShow),
      t('users.resetSuccess', { user: resetUser.username }),
    );
    if (!succeeded) return;
    setOneTimePassword({ username: resetUser.username, password: passwordToShow });
    setResetUser(null);
    setTemporaryPassword('');
  }

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((target) => {
      if (roleFilter && target.role !== roleFilter) return false;
      if (statusFilter === 'active' && !target.is_active) return false;
      if (statusFilter === 'inactive' && target.is_active) return false;
      if (statusFilter === 'must_change' && !target.must_change_password) return false;
      if (statusFilter === 'unused' && (!target.is_active || target.last_login)) return false;
      if (statusFilter === 'attention' && target.is_active && target.last_login && !target.must_change_password) return false;
      return !query || [target.username, target.full_name, target.email].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [roleFilter, search, statusFilter, users]);

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('users.eyebrow')}</p>
        <h2>{t('users.title')}</h2>
        <p>{t('users.description')}</p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="success-text" role="status" aria-live="polite">{notice}</p> : null}
      {oneTimePassword ? (
        <section className="warning-panel one-time-secret" role="status" aria-live="polite">
          <div>
            <h3>{t('users.temporary.title')}</h3>
            <p>{t('users.temporary.description', { user: oneTimePassword.username })}</p>
            <code>{oneTimePassword.password}</code>
          </div>
          <div className="action-row">
            <button type="button" onClick={() => void navigator.clipboard?.writeText(oneTimePassword.password)}>{t('users.temporary.copy')}</button>
            <button type="button" className="secondary-button" onClick={() => setOneTimePassword(null)}>{t('users.temporary.hide')}</button>
          </div>
        </section>
      ) : null}
      <form className="content-card form-stack" onSubmit={handleSubmit}>
        <h3>{t('users.createTitle')}</h3>
        <div className="form-grid form-grid--two">
          <label>
            <span>{t('users.fields.username')}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
          </label>
          <label>
            <span>{t('users.fields.fullName')}</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
        </div>
        <div className="form-grid form-grid--three">
          <label>
            <span>{t('users.fields.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            <span>{t('users.fields.role')}</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {t(`roles.${value}`)}
                </option>
              ))}
            </select>
            <small className="hint-text">{t(`users.roleExplanation.${role}`)}</small>
          </label>
          <label>
            <span>{t('users.fields.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        </div>
        <button type="submit" className="success-button" disabled={isSubmitting}>
          {isSubmitting ? t('users.saving') : t('users.addUser')}
        </button>
      </form>
      <section className="filter-panel admin-filter-grid" aria-label={t('users.filters.label')}>
        <label>
          <span>{t('users.filters.search')}</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          <span>{t('users.filters.role')}</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">{t('users.filters.allRoles')}</option>
            {ROLES.map((value) => <option key={value} value={value}>{t(`roles.${value}`)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('users.filters.status')}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {['', 'active', 'inactive', 'must_change', 'unused', 'attention'].map((value) => <option key={value || 'all'} value={value}>{t(`users.filters.${value || 'allStatuses'}`)}</option>)}
          </select>
        </label>
      </section>
      {isLoading ? (
        <LoadingState />
      ) : (
        <UserList
          users={filteredUsers}
          currentUsername={currentUser?.username}
          pendingId={pendingId}
          onRoleChange={handleRoleChange}
          onToggleActive={handleToggleActive}
          onReset={beginReset}
          language={i18n.language}
        />
      )}
      {resetUser ? (
        <form className="content-card form-stack" onSubmit={resetPassword}>
          <h3>{t('users.temporary.resetTitle', { user: resetUser.username })}</h3>
          <p>{t('users.temporary.resetDescription')}</p>
          <label>
            <span>{t('users.fields.temporaryPassword')}</span>
            <input type="text" autoComplete="off" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} />
          </label>
          <div className="action-row">
            <button type="submit" disabled={pendingId === resetUser.id}>{t('users.actions.setTemporaryPassword')}</button>
            <button type="button" className="secondary-button" onClick={() => setResetUser(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmChange)}
        title={t('users.confirmTitle')}
        description={confirmChange?.type === 'role'
          ? t('users.confirmRole', { user: confirmChange.user.username, role: t(`roles.${confirmChange.role}`) })
          : t(confirmChange?.user.is_active ? 'users.confirmDeactivate' : 'users.confirmReactivate', { user: confirmChange?.user.username })}
        confirmLabel={t('common.confirm')}
        onCancel={() => setConfirmChange(null)}
        onConfirm={confirmUpdate}
      />
    </section>
  );
}

function UserList({
  users,
  currentUsername,
  pendingId,
  onRoleChange,
  onToggleActive,
  onReset,
  language,
}: {
  users: ManagedUser[];
  currentUsername?: string;
  pendingId: string | null;
  onRoleChange: (user: ManagedUser, role: UserRole) => void;
  onToggleActive: (user: ManagedUser) => void;
  onReset: (user: ManagedUser) => void;
  language: string;
}) {
  const { t } = useTranslation();
  if (!users.length) {
    return <p className="hint-text">{t('users.empty')}</p>;
  }
  return (
    <div className="card-grid card-grid--two">
      {users.map((user) => {
        const isSelf = Boolean(currentUsername && user.username === currentUsername);
        const isBusy = pendingId === user.id;
        return (
          <article className="content-card" key={user.id}>
            <h3>{user.full_name || user.username}</h3>
            <p className="hint-text">
              {user.username}
              {user.email ? ` · ${user.email}` : ''}
            </p>
            <p className="hint-text">
              {user.is_active ? t('users.status.active') : t('users.status.inactive')}
              {isSelf ? ` · ${t('users.you')}` : ''}
              {user.must_change_password ? ` · ${t('users.status.mustChange')}` : ''}
            </p>
            <dl className="detail-list">
              <div><dt>{t('users.fields.lastLogin')}</dt><dd>{formatDateTime(user.last_login, language, t('users.never'))}</dd></div>
              <div><dt>{t('users.fields.dateJoined')}</dt><dd>{formatDateTime(user.date_joined, language, t('common.notAvailable'))}</dd></div>
            </dl>
            <label>
              <span>{t('users.fields.role')}</span>
              <select
                value={user.role}
                disabled={isBusy || isSelf}
                onChange={(event) => onRoleChange(user, event.target.value as UserRole)}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {t(`roles.${value}`)}
                  </option>
                ))}
              </select>
              <small className="hint-text">{t(`users.roleExplanation.${user.role}`)}</small>
            </label>
            <div className="action-row action-row--wrap">
              {!isSelf ? <button type="button" className="secondary-button" disabled={isBusy} onClick={() => onReset(user)}>{t('users.actions.resetPassword')}</button> : null}
              <button
                type="button"
                className={user.is_active ? 'danger-button' : 'success-button'}
                disabled={isBusy || isSelf}
                onClick={() => onToggleActive(user)}
              >
                {user.is_active ? t('users.actions.deactivate') : t('users.actions.activate')}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function generateTemporaryPassword() {
  const random = new Uint32Array(2);
  crypto.getRandomValues(random);
  return `Fleet-${random[0].toString(36)}-${random[1].toString(36)}!A7`;
}
