import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from 'react';

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
  children?: ReactNode;
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
  children,
}: SearchableSelectProps) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);
  const inputValue = isTyping ? query : selected?.label ?? '';

  const filtered = useMemo(() => {
    const trimmed = isTyping ? query.trim().toLowerCase() : '';
    if (!trimmed) {
      return options;
    }
    return options.filter((option) => `${option.label} ${option.keywords ?? ''}`.toLowerCase().includes(trimmed));
  }, [options, query, isTyping]);

  function choose(option: SearchableOption) {
    onChange(option.value);
    setQuery('');
    setIsTyping(false);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      setIsTyping(false);
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
        }
      }}
    >
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <div className="searchable-select__control">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
          value={inputValue}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsTyping(true);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {open ? (
          <ul className="searchable-select__list" role="listbox">
            {filtered.length === 0 ? (
              <li className="searchable-select__empty">{emptyText}</li>
            ) : (
              filtered.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    className={`searchable-select__option${option.value === value ? ' is-selected' : ''}`}
                    // Select on pointer/mouse down and keep the input focused, so
                    // the option is chosen before the input's blur can close the
                    // list (in Safari/Firefox clicking a button does not focus it,
                    // which otherwise dropped the selection).
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(option);
                    }}
                    onClick={() => choose(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {error ? <small className="field-error">{error}</small> : null}
      {children}
    </div>
  );
}
