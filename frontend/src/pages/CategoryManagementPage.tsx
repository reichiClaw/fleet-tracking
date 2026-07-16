import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createVehicleCategory,
  deactivateVehicleCategory,
  listVehicleCategories,
  updateVehicleCategory,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

export function CategoryManagementPage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [editing, setEditing] = useState<VehicleCategory | null>(null);
  const [confirming, setConfirming] = useState<VehicleCategory | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useDirtyFormWarning(Boolean(name || description), t('forms.unsaved'));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setCategories(await listVehicleCategories());
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t, t('categories.loadError')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function beginEdit(category: VehicleCategory) {
    setEditing(category);
    setName(category.name);
    setDescription(category.description ?? '');
  }

  function reset() {
    setEditing(null);
    setName('');
    setDescription('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (editing) {
        await updateVehicleCategory(editing.id, { name: name.trim(), description: description.trim() });
        setNotice(t('categories.updated'));
      } else {
        await createVehicleCategory({ name: name.trim(), description: description.trim(), is_active: true });
        setNotice(t('categories.created'));
      }
      reset();
      await load();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('categories.saveError')));
    } finally {
      setPending(false);
    }
  }

  async function deactivate() {
    if (!confirming || pending) return;
    setPending(true);
    setError(null);
    try {
      await deactivateVehicleCategory(confirming.id);
      setNotice(t('categories.deactivated'));
      setConfirming(null);
      await load();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('categories.saveError')));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t('categories.eyebrow')} title={t('categories.title')} description={t('categories.description')} />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {notice ? <p className="success-text" role="status" aria-live="polite">{notice}</p> : null}
      <form className="content-card form-stack" onSubmit={save}>
        <h3>{t(editing ? 'categories.edit' : 'categories.create')}</h3>
        <Field label={t('categories.fields.name')} required>
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label={t('categories.fields.description')}>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="action-row">
          <button className="success-button" disabled={pending} type="submit">
            {pending ? t('common.pending') : t('common.save')}
          </button>
          {editing ? <button className="secondary-button" disabled={pending} type="button" onClick={reset}>{t('common.cancel')}</button> : null}
        </div>
      </form>
      {loading ? <LoadingState /> : categories.length ? (
        <div className="card-grid card-grid--two">
          {categories.map((category) => (
            <article className="content-card" key={category.id}>
              <h3>{category.name}</h3>
              <p>{category.description || t('common.notAvailable')}</p>
              <p className="hint-text">{category.is_active ? t('categories.active') : t('categories.inactive')}</p>
              <div className="action-row">
                <button className="secondary-button" type="button" onClick={() => beginEdit(category)}>{t('common.edit')}</button>
                {category.is_active ? <button className="danger-button" type="button" onClick={() => setConfirming(category)}>{t('categories.deactivate')}</button> : null}
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState title={t('categories.empty')} />}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={t('categories.confirmTitle')}
        description={t('categories.confirmDescription', { name: confirming?.name })}
        confirmLabel={t('categories.deactivate')}
        busy={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void deactivate()}
      />
    </section>
  );
}
