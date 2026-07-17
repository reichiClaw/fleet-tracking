import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { DraftSaveStatus } from '../hooks/useWorkflowDraft';

export const WORKFLOW_STEPS = ['identify', 'partyTiming', 'conditionEvidence', 'reviewConfirm'] as const;

export function WorkflowWizard({
  currentStep,
  onBack,
  onNext,
  onGoToStep,
  submitLabel,
  submitting,
  consequence,
  saveStatus,
  navigationDisabled,
  onRetrySave,
  children,
}: {
  currentStep: number;
  onBack: () => void;
  onNext: () => void;
  onGoToStep?: (step: number) => void;
  submitLabel: string;
  submitting?: boolean;
  consequence?: string;
  saveStatus?: DraftSaveStatus;
  navigationDisabled?: boolean;
  onRetrySave?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFinal = currentStep === WORKFLOW_STEPS.length - 1;

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentStep]);

  return (
    <div className="workflow-wizard">
      <nav aria-label={t('wizard.progressLabel')}>
        <ol className="wizard-progress">
          {WORKFLOW_STEPS.map((step, index) => {
            const state = index < currentStep ? 'complete' : index === currentStep ? 'current' : 'upcoming';
            return (
              <li key={step} className={`wizard-progress__step wizard-progress__step--${state}`}>
                <button
                  type="button"
                  disabled={index > currentStep}
                  aria-current={index === currentStep ? 'step' : undefined}
                  onClick={() => index < currentStep && onGoToStep?.(index)}
                >
                  <span aria-hidden="true">{index < currentStep ? '✓' : index + 1}</span>
                  {t(`wizard.steps.${step}`)}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="wizard-step">
        <div className="wizard-step__heading">
          <p className="eyebrow">{t('wizard.stepCount', { current: currentStep + 1, total: WORKFLOW_STEPS.length })}</p>
          <h3 ref={headingRef} tabIndex={-1}>{t(`wizard.steps.${WORKFLOW_STEPS[currentStep]}`)}</h3>
        </div>
        {children}
      </div>

      {isFinal && consequence ? (
        <div className="consequence-panel" role="note">
          <strong>{t('wizard.consequenceTitle')}</strong>
          <p>{consequence}</p>
        </div>
      ) : null}

      <div className="wizard-actions">
        <div className="draft-status" role="status" aria-live="polite">
          {saveStatus ? t(`drafts.status.${saveStatus}`) : null}
          {saveStatus === 'error' && onRetrySave ? (
            <button type="button" className="link-button" onClick={onRetrySave}>
              {t('common.retry')}
            </button>
          ) : null}
        </div>
        <div className="action-row">
          <button type="button" className="secondary-button" disabled={currentStep === 0 || submitting || navigationDisabled} onClick={onBack}>
            {t('common.back')}
          </button>
          {isFinal ? (
            <button type="submit" disabled={submitting || navigationDisabled}>
              {submitting ? t('workflows.submitting') : submitLabel}
            </button>
          ) : (
            <button type="button" disabled={submitting || navigationDisabled} onClick={onNext}>
              {t('wizard.next')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DraftConflictNotice({
  onUseServer,
  onOverwrite,
}: {
  onUseServer: () => void;
  onOverwrite: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="state-card state-card--error" role="alert">
      <h3>{t('drafts.conflict.title')}</h3>
      <p>{t('drafts.conflict.description')}</p>
      <div className="action-row">
        <button type="button" onClick={onUseServer}>{t('drafts.conflict.useServer')}</button>
        <button type="button" className="secondary-button" onClick={onOverwrite}>{t('drafts.conflict.keepMine')}</button>
      </div>
    </section>
  );
}
