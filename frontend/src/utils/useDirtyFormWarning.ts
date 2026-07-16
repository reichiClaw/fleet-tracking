import { useEffect } from 'react';

export function useDirtyFormWarning(isDirty: boolean, message: string) {
  useEffect(() => {
    if (!isDirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    function beforeLink(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!anchor || event.defaultPrevented || event.button !== 0) return;
      const url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      if (url.origin === window.location.origin && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeLink, true);
    };
  }, [isDirty, message]);
}
