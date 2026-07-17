import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createVehicleCategory,
  deactivateVehicleCategory,
  listVehicleCategories,
  reactivateVehicleCategory,
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
  const [meterMode, setMeterMode] = useState<NonNullable<VehicleCategory['meter_mode']>>('both');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isDirty = name !== (editing?.name ?? '')
    || description !== (editing?.description ?? '')
    || meterMode !== (editing?.meter_mode ?? 'both');
  useDirtyFormWarning(isDirty, t('forms.unsaved'));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const nextCategories = await listVehicleCategories();
      setCategories(nextCategories);
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
    setMeterMode(category.meter_mode ?? 'odometer');
  }

  function reset() {
    setEditing(null);
    setName('');
    setDescription('');
    setMeterMode('both');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || !name.trim()) return;
    if (categories.some((category) => category.id !== editing?.id && category.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
      setError(t('categories.duplicateName'));
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (editing) {
        await updateVehicleCategory(editing.id, { name: name.trim(), description: description.trim(), meter_mode: meterMode });
        setNotice(t('categories.updated'));
      } else {
        await createVehicleCategory({ name: name.trim(), description: description.trim(), meter_mode: meterMode, is_active: true });
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

  async function reactivate(category: VehicleCategory) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await reactivateVehicleCategory(category.id);
      setNotice(t('categories.reactivated'));
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
        <Field label={t('categories.fields.meterMode')} hint={t(`categories.meterModes.${meterMode}.description`)} required>
          <select value={meterMode} onChange={(event) => setMeterMode(event.target.value as NonNullable<VehicleCategory['meter_mode']>)}>
            {(['odometer', 'hours', 'both', 'none'] as const).map((mode) => <option key={mode} value={mode}>{t(`categories.meterModes.${mode}.label`)}</option>)}
          </select>
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
              <dl className="detail-list">
                <div><dt>{t('categories.fields.meterMode')}</dt><dd>{t(`categories.meterModes.${category.meter_mode ?? 'both'}.label`)}</dd></div>
                <div><dt>{t('categories.affectedVehicles')}</dt><dd>{category.vehicle_count ?? 0}</dd></div>
              </dl>
              <div className="action-row">
                <button className="secondary-button" type="button" onClick={() => beginEdit(category)}>{t('common.edit')}</button>
                {category.is_active
                  ? <button className="danger-button" type="button" onClick={() => setConfirming(category)}>{t('categories.deactivate')}</button>
                  : <button className="success-button" type="button" disabled={pending} onClick={() => void reactivate(category)}>{t('categories.reactivate')}</button>}
              </div>
            </article>
          ))}
        </div>
      ) : <EmptyState title={t('categories.empty')} />}
      <ConfirmDialog
        open={Boolean(confirming)}
        title={t('categories.confirmTitle')}
        description={t('categories.confirmDescription', { name: confirming?.name, count: confirming?.vehicle_count ?? 0 })}
        confirmLabel={t('categories.deactivate')}
        busy={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void deactivate()}
      />
    </section>
  );
}
