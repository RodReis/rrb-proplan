import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LinkGoneError,
  UnreachableError,
  ValidationError,
  getCities,
  saveDraft,
  type Catalog,
  type Option,
  type PublicState,
} from './briefingApi';
import { StepField } from './StepField';
import {
  STEPS,
  STEP_COUNT,
  isBlank,
  missingFields,
  pruneBlank,
  stepDef,
  type Answers,
  type StepAnswers,
} from './steps';

/**
 * O formulário de 9 etapas (SPEC-031 §1 e §2).
 *
 * Três regras estruturais que este componente existe para cumprir:
 *
 * 1. **Uma etapa por tela, volta livre, avanço validado.** Voltar nunca perde o
 *    que foi respondido — as respostas vivem aqui, não no campo.
 * 2. **Autosave ao avançar e a cada 30 s de inatividade.** Quem responde não
 *    aperta "salvar": a spec promete retomar de onde parou, e isso só é verdade
 *    se o save acontecer sozinho.
 * 3. **A validação daqui é conveniência.** A barreira é a API — o 422 dela
 *    manda na tela, inclusive quando discorda desta checagem local.
 */

const AUTOSAVE_MS = 30_000;

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  /** Rede fora: o que foi digitado continua na tela, e o próximo save tenta de novo. */
  | { kind: 'offline' };

interface Props {
  token: string;
  initial: PublicState;
  catalog: Catalog;
  /** Link morreu no meio do preenchimento (revogado/expirado/enviado). */
  onLinkGone: () => void;
}

export function BriefingForm({ token, initial, catalog, onLinkGone }: Props) {
  const [step, setStep] = useState(() => clampStep(initial.step ?? 1));
  const [answers, setAnswers] = useState<Answers>(() => normalize(initial.answers));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [cities, setCities] = useState<Option[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  const def = stepDef(step)!;
  const current = answers[String(step)] ?? {};
  const state = typeof current.state === 'string' ? current.state : '';
  const segment = typeof current.segment === 'string' ? current.segment : '';

  /**
   * O que já foi persistido. Serve para o autosave não gastar requisição
   * mandando de novo uma etapa que não mudou — o rate limit de escrita é 10/min.
   */
  const savedRef = useRef<Record<string, string>>({});

  const persist = useCallback(
    async (n: number, values: StepAnswers): Promise<boolean> => {
      const payload = pruneBlank(values);
      const fingerprint = JSON.stringify(payload);

      // Etapa nunca tocada não vira requisição: salvar `{}` só para marcar
      // passagem mexeria no funil sem que ninguém tenha respondido nada.
      if (Object.keys(payload).length === 0) return true;
      if (savedRef.current[n] === fingerprint) return true;

      setSave({ kind: 'saving' });
      try {
        await saveDraft(token, n, payload);
        savedRef.current[n] = fingerprint;
        setSave({ kind: 'saved' });
        return true;
      } catch (err) {
        if (err instanceof ValidationError) {
          // O servidor discordou: a mensagem dele vence a checagem local.
          setErrors(
            Object.fromEntries(err.errors.map((e) => [e.field, e.message])),
          );
          setSave({ kind: 'idle' });
          return false;
        }
        if (err instanceof LinkGoneError) {
          onLinkGone();
          return false;
        }
        // 429 e 5xx: não é veredito sobre o link nem sobre a resposta.
        if (err instanceof UnreachableError) setSave({ kind: 'offline' });
        return false;
      }
    },
    [token, onLinkGone],
  );

  // Autosave por inatividade. O timer reinicia a cada tecla — o efeito depende
  // de `current`, então cada mudança derruba o anterior no cleanup.
  useEffect(() => {
    const id = setTimeout(() => void persist(step, current), AUTOSAVE_MS);
    return () => clearTimeout(id);
  }, [step, current, persist]);

  // Cidades do estado escolhido. A lista NÃO vem do IBGE em runtime (spec §3):
  // sai do nosso banco, semeado uma vez.
  useEffect(() => {
    if (step !== 1 || state === '') {
      setCities([]);
      return;
    }

    const controller = new AbortController();
    setLoadingCities(true);
    getCities(token, state, controller.signal)
      .then((list) => setCities(list))
      .catch(() => setCities([]))
      .finally(() => setLoadingCities(false));

    return () => controller.abort();
  }, [token, step, state]);

  const setField = (name: string, value: unknown) => {
    setAnswers((prev) => ({
      ...prev,
      [String(step)]: { ...(prev[String(step)] ?? {}), [name]: value },
    }));
    // Erro de um campo morre quando ele é editado — manter o alerta enquanto a
    // pessoa corrige faria a tela discutir com quem já concordou.
    setErrors((prev) => (name in prev ? omit(prev, name) : prev));
  };

  const goTo = (n: number) => {
    setErrors({});
    setStep(clampStep(n));
    // Etapa nova entra pelo topo: a anterior pode ter rolado a página.
    window.scrollTo({ top: 0 });
  };

  const advance = async () => {
    const missing = missingFields(step, current);
    if (missing.length > 0) {
      setErrors(
        Object.fromEntries(
          missing.map((f) => [
            f,
            f === 'confirmed' ? 'confirmação obrigatória' : 'obrigatório',
          ]),
        ),
      );
      return;
    }

    // Salva ANTES de avançar: se o servidor recusar, a pessoa fica na etapa em
    // que está o erro. Avançar e depois falhar mostraria o problema longe dele.
    if (!(await persist(step, current))) return;
    if (step < STEP_COUNT) goTo(step + 1);
  };

  const isLast = step === STEP_COUNT;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          ProPlan · Briefing
        </p>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-text2">{def.title}</h1>
          <span className="shrink-0 font-mono text-[11px] text-faint">
            Etapa {step} de {STEP_COUNT}
          </span>
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-body2">{def.intro}</p>

        <div
          className="mt-4 h-1 w-full overflow-hidden rounded-full bg-surface2"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-label={`Etapa ${step} de ${STEP_COUNT}`}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${(step / STEP_COUNT) * 100}%` }}
          />
        </div>
      </header>

      <div className="rounded-[14px] border border-border bg-panel px-5 py-6">
        {def.notice && (
          <p className="mb-5 rounded-md border border-border2 bg-surface px-3 py-2.5 text-xs leading-relaxed text-body2">
            {def.notice}
          </p>
        )}

        <div className="space-y-5">
          {def.fields.map((field) => (
            <StepField
              key={field.name}
              field={field}
              value={current[field.name]}
              onChange={(value) => setField(field.name, value)}
              error={errors[field.name]}
              catalog={catalog}
              cities={cities}
              segment={segment}
              isLoadingCities={loadingCities}
            />
          ))}
        </div>

        {isLast && <Review answers={answers} onEdit={goTo} catalog={catalog} />}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          disabled={step === 1}
          className="rounded-md border border-border2 px-3.5 py-2 text-xs font-semibold text-text2 transition-colors duration-150 hover:bg-surface-hover disabled:opacity-40"
        >
          Voltar
        </button>

        <SaveHint state={save} />

        <button
          type="button"
          onClick={() => void advance()}
          // A etapa 9 ainda não envia: o submit é o PR-5. Salvar a etapa é o que
          // esta fatia sabe fazer, e prometer envio agora seria mentira na tela.
          disabled={isLast}
          className="rounded-md bg-btnbg px-4 py-2 text-xs font-semibold text-btnfg transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
        >
          {isLast ? 'Revisar e enviar' : 'Continuar'}
        </button>
      </div>

      {isLast && (
        <p className="mt-3 text-center text-xs text-faint">
          O envio definitivo chega na próxima entrega. Suas respostas já estão
          salvas e você pode voltar quando quiser.
        </p>
      )}
    </div>
  );
}

/**
 * Revisão da etapa 9: todas as respostas, com atalho para corrigir.
 *
 * A spec pede "revisão de todas as respostas" antes da confirmação — sem isso a
 * confirmação seria assinar em branco.
 */
function Review({
  answers,
  onEdit,
  catalog,
}: {
  answers: Answers;
  onEdit: (step: number) => void;
  catalog: Catalog;
}) {
  /**
   * Segmento e estado são escolhidos por rótulo e gravados por código (`G`,
   * `SP`). A revisão mostra o rótulo: quem respondeu "Comércio e varejo" não
   * reconhece "G", e revisar o que não se entende não é revisar.
   */
  const optionsOf = (step: number, field: string) =>
    step === 1 && field === 'segment'
      ? catalog.segments
      : step === 1 && field === 'state'
        ? catalog.states
        : undefined;

  return (
    <section className="mt-7 border-t border-border pt-5">
      <h2 className="text-sm font-semibold text-text2">Suas respostas</h2>

      <dl className="mt-3 space-y-4">
        {STEPS.filter((s) => s.n < STEP_COUNT).map((s) => {
          const given = answers[String(s.n)] ?? {};
          const filled = s.fields.filter((f) => !isBlank(given[f.name]));

          return (
            <div key={s.n}>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                  {s.n}. {s.title}
                </dt>
                <button
                  type="button"
                  onClick={() => onEdit(s.n)}
                  className="shrink-0 text-xs font-medium text-body2 underline underline-offset-2 hover:text-text2"
                >
                  Editar
                </button>
              </div>

              {filled.length === 0 ? (
                <dd className="mt-1 text-xs italic text-dim">Não informado</dd>
              ) : (
                filled.map((f) => (
                  <dd key={f.name} className="mt-1 text-xs leading-relaxed text-body2">
                    <span className="text-faint">{f.label}: </span>
                    {display(given[f.name], f.options ?? optionsOf(s.n, f.name))}
                  </dd>
                ))
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function SaveHint({ state }: { state: SaveState }) {
  if (state.kind === 'idle') return <span aria-hidden="true" />;

  const text =
    state.kind === 'saving'
      ? 'Salvando…'
      : state.kind === 'saved'
        ? 'Salvo'
        : 'Sem conexão — vamos tentar de novo';

  return (
    <span
      role="status"
      className={
        'text-center text-[11px] ' +
        (state.kind === 'offline' ? 'text-warning' : 'text-faint')
      }
    >
      {text}
    </span>
  );
}

/** Mostra o RÓTULO do valor escolhido, não o código que vai no `jsonb`. */
function display(
  value: unknown,
  options?: readonly { value: string; label: string }[],
): string {
  if (Array.isArray(value)) return value.join(', ');
  if (value === true) return 'Sim';
  const text = String(value ?? '');
  return options?.find((o) => o.value === text)?.label ?? text;
}

function clampStep(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), STEP_COUNT);
}

/**
 * Chaves do `jsonb` viram string no caminho de volta — o backend indexa por
 * número. Normalizar na entrada evita a etapa 1 vir como `1` e ser procurada
 * como `"1"`.
 */
function normalize(answers?: Answers): Answers {
  if (!answers) return {};
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [String(key), value ?? {}]),
  );
}

function omit(source: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _dropped, ...rest } = source;
  return rest;
}
