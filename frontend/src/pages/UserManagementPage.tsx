import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createUser,
  deactivateUser,
  listUsers,
  updateUser,
  type ManagedUser,
  type UserRole,
} from '../api/fleet';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';

const ROLES: UserRole[] = ['admin', 'operations', 'readonly'];

export function UserManagementPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
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

  async function loadUsers() {
    setIsLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch {
      setError(t('users.loadError'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setUsername('');
      setFullName('');
      setEmail('');
      setRole('operations');
      setPassword('');
      setNotice(t('users.created'));
      await loadUsers();
    } catch {
      setError(t('users.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runUpdate(id: string, action: () => Promise<unknown>) {
    setPendingId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      await loadUsers();
    } catch {
      setError(t('users.saveError'));
    } finally {
      setPendingId(null);
    }
  }

  function handleRoleChange(target: ManagedUser, nextRole: UserRole) {
    if (nextRole === target.role) {
      return;
    }
    void runUpdate(target.id, () => updateUser(target.id, { role: nextRole }));
  }

  function handleToggleActive(target: ManagedUser) {
    void runUpdate(target.id, () =>
      target.is_active ? deactivateUser(target.id) : updateUser(target.id, { is_active: true }),
    );
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('users.eyebrow')}</p>
        <h2>{t('users.title')}</h2>
        <p>{t('users.description')}</p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="hint-text">{notice}</p> : null}
      <form className="content-card form-stack" onSubmit={handleSubmit}>
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
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('users.saving') : t('users.addUser')}
        </button>
      </form>
      {isLoading ? (
        <LoadingState />
      ) : (
        <UserList
          users={users}
          currentUsername={currentUser?.username}
          pendingId={pendingId}
          onRoleChange={handleRoleChange}
          onToggleActive={handleToggleActive}
        />
      )}
    </section>
  );
}

function UserList({
  users,
  currentUsername,
  pendingId,
  onRoleChange,
  onToggleActive,
}: {
  users: ManagedUser[];
  currentUsername?: string;
  pendingId: string | null;
  onRoleChange: (user: ManagedUser, role: UserRole) => void;
  onToggleActive: (user: ManagedUser) => void;
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
            </p>
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
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={isBusy || isSelf}
              onClick={() => onToggleActive(user)}
            >
              {user.is_active ? t('users.actions.deactivate') : t('users.actions.activate')}
            </button>
          </article>
        );
      })}
    </div>
  );
}
