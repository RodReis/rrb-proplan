import type { Catalog, Option } from './briefingApi';
import { applyMask, MASK_INPUT_MODE, MASK_PLACEHOLDER } from './masks';
import { COMPLEXITY_OPTIONS, type FieldDef } from './steps';

/**
 * Um campo do briefing, escolhido pelo `kind` da definição da etapa.
 *
 * Componente burro de propósito: recebe valor e `onChange`, não sabe de rascunho,
 * de rede nem de qual etapa está. Quem orquestra é o `BriefingForm`.
 */

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Mensagem de erro do campo — do 422 do servidor ou da checagem local. */
  error?: string;
  /** Etapa 1: listas que vêm da API (segmentos, estados, catálogo). */
  catalog?: Catalog;
  cities?: Option[];
  /** Segmento escolhido: filtra o catálogo de serviços. */
  segment?: string;
  isLoadingCities?: boolean;
}

const inputClass = 'briefing-control';

export function StepField({
  field,
  value,
  onChange,
  error,
  catalog,
  cities,
  segment,
  isLoadingCities,
}: Props) {
  const id = `field-${field.name}`;
  const describedBy = [error ? `${id}-error` : null, field.hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`briefing-field${error ? ' briefing-field--error' : ''}`}>
      {/* O checkbox traz o próprio rótulo ao lado da caixa. */}
      {field.kind !== 'checkbox' && (
        <label htmlFor={id} className="briefing-label">
          {field.label}
          {field.required && (
            <span className="briefing-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <Control
        id={id}
        field={field}
        value={value}
        onChange={onChange}
        describedBy={describedBy || undefined}
        hasError={Boolean(error)}
        catalog={catalog}
        cities={cities}
        segment={segment}
        isLoadingCities={isLoadingCities}
      />

      {field.hint && (
        <p id={`${id}-hint`} className="briefing-hint">
          {field.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="briefing-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface ControlProps extends Omit<Props, 'error'> {
  id: string;
  describedBy?: string;
  hasError: boolean;
}

function Control({
  id,
  field,
  value,
  onChange,
  describedBy,
  hasError,
  catalog,
  cities,
  segment,
  isLoadingCities,
}: ControlProps) {
  const border = hasError ? ' briefing-control--error' : '';

  switch (field.kind) {
    case 'textarea':
      return (
        <textarea
          id={id}
          rows={3}
          className={inputClass + border}
          placeholder={field.placeholder}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'select': {
      // A etapa 1 tem dois selects cujas opções vêm da API; os demais são fixos.
      const options =
        field.options ??
        (field.name === 'segment'
          ? catalog?.segments
          : field.name === 'state'
            ? catalog?.states
            : undefined) ??
        [];

      return (
        <select
          id={id}
          className={inputClass + border}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    case 'city':
      return (
        <select
          id={id}
          className={inputClass + border}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          // Sem estado escolhido não há cidade que faça sentido oferecer.
          disabled={!cities || cities.length === 0}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {isLoadingCities
              ? 'Carregando…'
              : cities && cities.length > 0
                ? 'Selecione…'
                : 'Escolha o estado primeiro'}
          </option>
          {(cities ?? []).map((c) => (
            <option key={c.value} value={c.label}>
              {c.label}
            </option>
          ))}
        </select>
      );

    case 'checkbox':
      return (
        <label htmlFor={id} className="briefing-check">
          <input
            id={id}
            type="checkbox"
            className="briefing-checkbox"
            aria-describedby={describedBy}
            aria-invalid={hasError || undefined}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );

    case 'list':
      return (
        <ListField
          id={id}
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
          describedBy={describedBy}
        />
      );

    case 'services':
      return (
        <ServicesField
          id={id}
          value={value}
          onChange={onChange}
          options={(segment && catalog?.services[segment]) || []}
          describedBy={describedBy}
        />
      );

    case 'complexity':
      return (
        <ComplexityField
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          describedBy={describedBy}
        />
      );

    default:
      return (
        <input
          id={id}
          type="text"
          className={inputClass + border}
          // Máscara: teclado numérico no celular e o formato visível antes da
          // primeira tecla. Sem máscara, o placeholder da definição manda.
          inputMode={field.mask ? MASK_INPUT_MODE[field.mask] : undefined}
          placeholder={
            field.placeholder ?? (field.mask ? MASK_PLACEHOLDER[field.mask] : undefined)
          }
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) =>
            onChange(
              field.mask ? applyMask(field.mask, e.target.value) : e.target.value,
            )
          }
        />
      );
  }
}

/**
 * Lista de textos livres, uma por linha.
 *
 * Textarea em vez de N inputs com botão de adicionar: quem responde um briefing
 * pela primeira vez entende "uma por linha" sem instrução, e não há estado
 * intermediário para perder no autosave.
 */
function ListField({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
  describedBy?: string;
}) {
  const text = Array.isArray(value) ? value.join('\n') : '';

  return (
    <textarea
      id={id}
      rows={3}
      className={inputClass}
      placeholder={placeholder}
      aria-describedby={describedBy}
      value={text}
      onChange={(e) => {
        const lines = e.target.value
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');
        onChange(lines);
      }}
    />
  );
}

/**
 * Catálogo curado + item livre (spec §3).
 *
 * O que a pessoa digita entra na resposta e **não** vira linha no catálogo do
 * tenant — a curadoria é do prestador, não de quem responde.
 */
function ServicesField({
  id,
  value,
  onChange,
  options,
  describedBy,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options: string[];
  describedBy?: string;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const toggle = (label: string) =>
    onChange(
      selected.includes(label)
        ? selected.filter((s) => s !== label)
        : [...selected, label],
    );

  // Os que não estão na lista curada: foram digitados. Ficam visíveis para não
  // sumirem sem aviso quando o segmento muda.
  const extras = selected.filter((s) => !options.includes(s));

  return (
    <div className="briefing-services" aria-describedby={describedBy}>
      {options.length > 0 && (
        <div className="briefing-chip-row">
          {options.map((label) => {
            const on = selected.includes(label);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(label)}
                className={
                  'briefing-chip ' +
                  (on
                    ? 'briefing-chip--on'
                    : 'briefing-chip--off')
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <input
        id={id}
        type="text"
        className={inputClass}
        placeholder="Acrescentar outro e pressionar Enter"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const typed = e.currentTarget.value.trim();
          if (typed === '' || selected.includes(typed)) return;
          onChange([...selected, typed]);
          e.currentTarget.value = '';
        }}
      />

      {extras.length > 0 && (
        <div className="briefing-chip-row">
          {extras.map((label) => (
            <span
              key={label}
              className="briefing-extra-chip"
            >
              {label}
              <button
                type="button"
                aria-label={`Remover ${label}`}
                onClick={() => onChange(selected.filter((s) => s !== label))}
                className="briefing-chip-remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Os três níveis da etapa 9.
 *
 * **Nenhum nome de modelo aparece aqui** — a spec §1 é explícita, e o critério
 * de aceite manda conferir no payload também. O que a pessoa lê é profundidade
 * de análise, que é o que a escolha significa para ela.
 */
function ComplexityField({
  value,
  onChange,
  describedBy,
}: {
  value: string;
  onChange: (value: unknown) => void;
  describedBy?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Nível de complexidade"
      aria-describedby={describedBy}
      className="briefing-complexity"
    >
      {COMPLEXITY_OPTIONS.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt.value)}
            className={
              'briefing-complexity-card ' +
              (on ? 'briefing-complexity-card--on' : 'briefing-complexity-card--off')
            }
          >
            <span className="briefing-complexity-title">
              <span aria-hidden="true" />
              {opt.label}
            </span>
            <span className="briefing-complexity-description">
              {opt.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
