import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchableOption = {
  value: string;
  label: string;
  /** Extra text (kept lowercase-insensitive) that the query is matched against. */
  keywords?: string;
};

type SearchableSelectProps = {
  label: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  loadOptions?: (query: string, signal: AbortSignal) => Promise<SearchableOption[]>;
  loadingText?: string;
};

/**
 * Accessible type-ahead select. Shows a text input that filters a dropdown list
 * across each option's label and keywords, so long lists (vehicles, drivers,
 * companies) are quick to search.
 */
export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  error,
  required,
  disabled,
  children,
  loadOptions,
  loadingText = 'Loading…',
}: SearchableSelectProps) {
  const inputId = useId();
  const listId = `${inputId}-listbox`;
  const errorId = `${inputId}-error`;
  const [query, setQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteOptions, setRemoteOptions] = useState<SearchableOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);

  const availableOptions = loadOptions && remoteOptions ? remoteOptions : options;
  const selected = useMemo(
    () => availableOptions.find((option) => option.value === value) ?? options.find((option) => option.value === value) ?? null,
    [availableOptions, options, value],
  );
  const inputValue = isTyping ? query : selected?.label ?? '';

  const filtered = useMemo(() => {
    const trimmed = isTyping ? query.trim().toLowerCase() : '';
    if (!trimmed) {
      return availableOptions;
    }
    if (loadOptions) return availableOptions;
    return availableOptions.filter((option) => `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(trimmed));
  }, [availableOptions, loadOptions, query, isTyping]);

  useEffect(() => {
    if (!loadOptions || !open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        setRemoteOptions(await loadOptions(isTyping ? query.trim() : '', controller.signal));
      } catch (error) {
        if (!controller.signal.aborted) setRemoteOptions([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, isTyping ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isTyping, loadOptions, open, query]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setIsTyping(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(filtered.length - 1);
  }, [activeIndex, filtered.length]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  function choose(option: SearchableOption) {
    onChange(option.value);
    setQuery('');
    setIsTyping(false);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        const selectedIndex = filtered.findIndex((option) => option.value === value);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : event.key === 'ArrowDown' ? 0 : filtered.length - 1);
        return;
      }
      if (!filtered.length) return;
      setActiveIndex((current) => {
        if (event.key === 'ArrowDown') return current < filtered.length - 1 ? current + 1 : 0;
        return current > 0 ? current - 1 : filtered.length - 1;
      });
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(filtered.length ? 0 : -1);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === 'Enter' && open && activeIndex >= 0) {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) choose(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setIsTyping(false);
      setQuery('');
      setActiveIndex(-1);
    } else if (event.key === 'Tab') {
      setOpen(false);
      setIsTyping(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div
      className="searchable-select"
      ref={containerRef}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
          setIsTyping(false);
          setActiveIndex(-1);
        }
      }}
    >
      <label htmlFor={inputId} className="field-label">
        {label}{required ? <span className="required-marker" aria-hidden="true"> *</span> : null}
      </label>
      <div className="searchable-select__control">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${inputId}-option-${activeIndex}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          aria-required={required}
          autoComplete="off"
          disabled={disabled}
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsTyping(true);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setOpen(true);
            const selectedIndex = filtered.findIndex((option) => option.value === value);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : filtered.length ? 0 : -1);
          }}
          onKeyDown={handleKeyDown}
        />
        {open ? (
          <ul id={listId} className="searchable-select__list" role="listbox" aria-label={label}>
            {isLoading ? (
              <li className="searchable-select__empty" role="option" aria-disabled="true">
                {loadingText}
              </li>
            ) : filtered.length === 0 ? (
              <li className="searchable-select__empty" role="option" aria-disabled="true">
                {emptyText}
              </li>
            ) : (
              filtered.map((option, index) => (
                <li
                    ref={(node) => { optionRefs.current[index] = node; }}
                    id={`${inputId}-option-${index}`}
                    key={option.value}
                    role="option"
                    aria-selected={option.value === value}
                    className={`searchable-select__option${option.value === value ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
                    // Select on pointer/mouse down and keep the input focused, so
                    // the option is chosen before the input's blur can close the
                    // list (in Safari/Firefox clicking a button does not focus it,
                    // which otherwise dropped the selection).
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => choose(option)}
                    onMouseMove={() => setActiveIndex(index)}
                  >
                    {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
      {children}
    </div>
  );
}
