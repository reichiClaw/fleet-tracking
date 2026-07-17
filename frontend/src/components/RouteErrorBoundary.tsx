import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  children: ReactNode;
  title: string;
  description: string;
  retryLabel: string;
};

type State = { error: Error | null };

class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route chunk failed to render', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="state-card state-card--error" role="alert">
        <h2>{this.props.title}</h2>
        <p>{this.props.description}</p>
        <button type="button" onClick={() => window.location.reload()}>{this.props.retryLabel}</button>
      </section>
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Boundary
      title={t('routeError.title')}
      description={t('routeError.description')}
      retryLabel={t('routeError.reload')}
    >
      {children}
    </Boundary>
  );
}
