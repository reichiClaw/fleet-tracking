import { useCallback } from 'react';
import { unstable_usePrompt, useBeforeUnload } from 'react-router-dom';

export function useDirtyFormWarning(isDirty: boolean, message: string) {
  useBeforeUnload(
    useCallback((event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    }, [isDirty]),
    { capture: true },
  );

  // A router blocker covers links, imperative navigate() calls, and browser
  // back/forward traversal. The former document click listener only saw links.
  unstable_usePrompt({ when: isDirty, message });
}
