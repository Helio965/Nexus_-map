import type { LatLng, PlaceSuggestion, PlaceSummary } from '@nexus/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, isAbort } from '../../api/client';
import { useDebouncedValue } from '../../hooks/basic';
import { Spinner } from '../common/ui';

interface Props {
  label: string;
  badge: 'A' | 'B';
  text: string;
  place: PlaceSummary | null;
  bias: LatLng | null;
  onText: (text: string) => void;
  onPlace: (place: PlaceSummary, text: string) => void;
  disabled?: boolean;
}

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/**
 * Combobox ARIA (WAI-ARIA 1.2) com autocomplete da Places API (New) via servidor.
 * Só aceita um local escolhido da lista (Place ID → Place Details), nunca texto solto.
 */
export function PlaceSearchInput({
  label,
  badge,
  text,
  place,
  bias,
  onText,
  onPlace,
  disabled,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    query: string;
    suggestions: PlaceSuggestion[];
    error: string | null;
  } | null>(null);
  const [active, setActive] = useState(-1);
  const [resolving, setResolving] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const debounced = useDebouncedValue(text, DEBOUNCE_MS);
  const shouldSearch = !place && debounced.trim().length >= MIN_CHARS;

  useEffect(() => {
    if (!shouldSearch) return;
    const controller = new AbortController();
    session.current ??= crypto.randomUUID();
    api
      .autocomplete(debounced, session.current, bias, controller.signal)
      .then((r) => {
        setResult({ query: debounced, suggestions: r.suggestions, error: null });
        setActive(r.suggestions.length > 0 ? 0 : -1);
        setOpen(true);
      })
      .catch((err: Error) => {
        if (isAbort(err)) return;
        setResult({ query: debounced, suggestions: [], error: err.message });
      });
    return () => controller.abort();
  }, [debounced, shouldSearch, bias]);

  // Estado derivado: sugestões só valem para a consulta atual.
  const current = shouldSearch && result?.query === debounced ? result : null;
  const suggestions = current?.suggestions ?? [];
  const loading = shouldSearch && !current;
  const error = detailsError ?? current?.error ?? null;

  async function choose(s: PlaceSuggestion) {
    setOpen(false);
    setResolving(true);
    setDetailsError(null);
    try {
      const details = await api.placeDetails(s.placeId, session.current ?? crypto.randomUUID());
      onPlace(details, s.mainText);
    } catch (err) {
      setDetailsError((err as Error).message || 'Não foi possível localizar esse endereço.');
    } finally {
      session.current = null; // sessão termina no Place Details
      setResolving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      void choose(suggestions[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showEmpty =
    open &&
    !loading &&
    !place &&
    debounced.trim().length >= MIN_CHARS &&
    suggestions.length === 0 &&
    !error;

  return (
    <div className={`place-field ${place ? 'place-field--ok' : ''}`}>
      <label htmlFor={id} className="place-field__label">
        <span className={`pin-badge pin-badge--${badge}`} aria-hidden="true">
          {badge}
        </span>
        {label}
      </label>
      <div className="place-field__control">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={`${id}-hint`}
          aria-invalid={!!error}
          autoComplete="off"
          spellCheck={false}
          placeholder="Pesquisar local…"
          value={text}
          disabled={disabled}
          onChange={(e) => {
            onText(e.target.value);
            setDetailsError(null);
            setOpen(true);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {(loading || resolving) && (
          <Spinner label={resolving ? 'Carregando detalhes do local' : 'Buscando sugestões'} />
        )}
      </div>
      <p id={`${id}-hint`} className="place-field__hint" aria-live="polite">
        {error ? (
          <span className="text-error">{error}</span>
        ) : place ? (
          <span className="text-ok">✓ {place.address ?? place.name}</span>
        ) : text.length > 0 && text.length < MIN_CHARS ? (
          `Digite pelo menos ${MIN_CHARS} caracteres.`
        ) : text.length >= MIN_CHARS ? (
          'Escolha um local da lista para validar o endereço.'
        ) : null}
      </p>
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="suggestions"
          aria-label={`Sugestões para ${label.toLowerCase()}`}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggestion ${i === active ? 'suggestion--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                void choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggestion__main">{s.mainText}</span>
              {s.secondaryText && <span className="suggestion__secondary">{s.secondaryText}</span>}
            </li>
          ))}
          <li role="presentation" className="suggestions__attribution">
            Sugestões: Google Places
          </li>
        </ul>
      )}
      {showEmpty && (
        <p className="place-field__hint text-warn" role="status">
          Não foi possível localizar esse endereço.
        </p>
      )}
    </div>
  );
}
