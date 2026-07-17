import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { WorkflowWizard } from './WorkflowWizard';

describe('WorkflowWizard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('focuses the current step and exposes completed steps to keyboard users', () => {
    const goToStep = vi.fn();
    const { rerender } = render(
      <form>
        <WorkflowWizard
          currentStep={1}
          onBack={vi.fn()}
          onNext={vi.fn()}
          onGoToStep={goToStep}
          submitLabel="Complete"
          saveStatus="saved"
        >
          <p>Party fields</p>
        </WorkflowWizard>
      </form>,
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Party / timing' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Identify' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Party / timing' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Condition / evidence' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Identify' }));
    expect(goToStep).toHaveBeenCalledWith(0);

    rerender(
      <form>
        <WorkflowWizard
          currentStep={2}
          onBack={vi.fn()}
          onNext={vi.fn()}
          onGoToStep={goToStep}
          submitLabel="Complete"
          saveStatus="saved"
        >
          <p>Condition fields</p>
        </WorkflowWizard>
      </form>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Condition / evidence' })).toHaveFocus();
  });

  it('separates the final consequence from the confirmation action', () => {
    render(
      <form>
        <WorkflowWizard
          currentStep={3}
          onBack={vi.fn()}
          onNext={vi.fn()}
          submitLabel="Return to manufacturer"
          consequence="The vehicle will leave the active fleet."
          saveStatus="offline"
        >
          <p>Review values</p>
        </WorkflowWizard>
      </form>,
    );

    expect(screen.getByRole('note')).toHaveTextContent('The vehicle will leave the active fleet.');
    expect(screen.getByRole('button', { name: 'Return to manufacturer' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
  });
});
