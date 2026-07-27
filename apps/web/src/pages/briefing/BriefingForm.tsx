import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { Attachments } from './Attachments';
import {
  LinkGoneError,
  UnreachableError,
  ValidationError,
  getCities,
  saveDraft,
  submitBriefing,
  type Catalog,
  type Option,
  type PublicState,
  type SubmitResult,
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
import './BriefingForm.css';

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

/** Etapa 5, "Conteúdo e identidade" — onde a spec §1 põe os anexos. */
const ATTACHMENTS_STEP = 5;

const STEP_ACCENTS = [
  'var(--info)',
  'var(--warning)',
  'var(--success)',
  'var(--write)',
  'var(--accent)',
  'var(--info)',
  'var(--warning)',
  'var(--write)',
  'var(--success)',
] as const;

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
  /** Briefing enviado — quem decide o que mostrar depois é a página. */
  onSubmitted: (result: SubmitResult) => void;
}

export function BriefingForm({
  token,
  initial,
  catalog,
  onLinkGone,
  onSubmitted,
}: Props) {
  const [step, setStep] = useState(() => clampStep(initial.step ?? 1));
  const [answers, setAnswers] = useState<Answers>(() => normalize(initial.answers));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [cities, setCities] = useState<Option[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Erro do envio — separado de `errors`, que é por campo. */
  const [submitError, setSubmitError] = useState<string | null>(null);

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

    // Última etapa: salvar a etapa 9 é só metade — o envio é o que a pessoa
    // veio fazer (SPEC-031 §5).
    if (step === STEP_COUNT) {
      await send();
      return;
    }

    goTo(step + 1);
  };

  /**
   * Envia o briefing. Idempotente no servidor, mas o botão trava mesmo assim:
   * dois requests em voo custam rate limit à toa, e a resposta de "já enviado"
   * chegaria depois de a tela já ter mudado.
   */
  const send = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await submitBriefing(token);
      onSubmitted(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        // Briefing incompleto: o servidor diz QUAIS campos, e em qual etapa.
        // Levar a pessoa até a primeira etapa com erro é melhor que só listar.
        const first = err.errors[0];
        setErrors(Object.fromEntries(err.errors.map((e) => [e.field, e.message])));
        setSubmitError(
          first && first.step !== STEP_COUNT
            ? `Falta preencher a etapa ${first.step}. Use "Editar" na revisão acima.`
            : 'Confira os campos obrigatórios antes de enviar.',
        );
      } else if (err instanceof LinkGoneError) {
        onLinkGone();
      } else if (err instanceof UnreachableError) {
        // 429 e 5xx não são veredito sobre o briefing — e o envio pode ter
        // funcionado. Mandar tentar de novo é seguro: o servidor é idempotente.
        setSubmitError('Não foi possível enviar agora. Tente de novo.');
      } else {
        setSubmitError('Não foi possível enviar o briefing.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isLast = step === STEP_COUNT;
  const shellStyle = {
    '--briefing-accent': STEP_ACCENTS[step - 1] ?? 'var(--accent)',
    '--briefing-progress': `${(step / STEP_COUNT) * 100}%`,
  } as CSSProperties;

  return (
    <div className="briefing-shell" style={shellStyle}>
      <aside className="briefing-rail" aria-label="Progresso do briefing">
        <div>
          <p className="briefing-kicker">ProPlan · Briefing</p>
          <h2 className="briefing-rail-title">Conte a história do projeto sem pressa.</h2>
          <p className="briefing-rail-copy">
            Uma etapa por vez. O rascunho salva sozinho quando houver conexão.
          </p>
        </div>

        <ol className="briefing-steps">
          {STEPS.map((item) => {
            const status =
              item.n < step ? 'done' : item.n === step ? 'current' : 'pending';
            return (
              <li key={item.n} className={`briefing-step briefing-step--${status}`}>
                <span className="briefing-step-index" aria-hidden="true">
                  {item.n}
                </span>
                <span className="briefing-step-text">
                  <span>
                    {item.n}. {item.title}
                  </span>
                  <small>
                    {status === 'done'
                      ? 'Respondido'
                      : status === 'current'
                        ? 'Agora'
                        : 'Próximo'}
                  </small>
                </span>
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="briefing-main">
        <header className="briefing-header">
          <div className="briefing-heading-row">
            <div>
              <span className="briefing-step-pill">Passo {step}</span>
              <h1>{def.title}</h1>
            </div>
            <span className="briefing-count">Etapa {step} de {STEP_COUNT}</span>
          </div>
          <p className="briefing-intro">{def.intro}</p>

          <div
            className="briefing-progress"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={STEP_COUNT}
            aria-label={`Etapa ${step} de ${STEP_COUNT}`}
          >
            <span />
          </div>
        </header>

        <div key={step} className="briefing-card">
          {def.notice && <p className="briefing-notice">{def.notice}</p>}

          <div className="briefing-fields">
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

            {/*
              Anexos ficam FORA do laço de campos: não moram no `jsonb` das
              respostas como os demais, e sim na própria tabela `file_assets`
              (ADR-025). Sobem no momento em que são escolhidos, sem esperar o
              save da etapa — por isso o componente tem rede própria.
            */}
            {step === ATTACHMENTS_STEP && (
              <Attachments token={token} onLinkGone={onLinkGone} />
            )}
          </div>

          {isLast && <Review answers={answers} onEdit={goTo} catalog={catalog} />}
        </div>

        <div className="briefing-actions">
          <button
            type="button"
            onClick={() => goTo(step - 1)}
            disabled={step === 1}
            className="briefing-button briefing-button--ghost"
          >
            Voltar
          </button>

          <SaveHint state={save} />

          <button
            type="button"
            onClick={() => void advance()}
            // Trava só enquanto o envio está em voo. O servidor é idempotente,
            // mas dois requests custam rate limit à toa.
            disabled={submitting}
            className="briefing-button briefing-button--primary"
          >
            {isLast ? (submitting ? 'Enviando…' : 'Enviar briefing') : 'Continuar'}
          </button>
        </div>

        {submitError && (
          <p role="alert" className="briefing-submit-error">
            {submitError}
          </p>
        )}
      </section>

      {/*
        Sem repetir "depois do envio nada muda" aqui: o hint do checkbox de
        confirmação já diz isso, logo acima. Dois avisos idênticos na mesma tela
        cansam a leitura e fazem o segundo virar ruído.
      */}
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
    <section className="briefing-review">
      <div className="briefing-review-head">
        <span className="briefing-step-pill">Revisão</span>
        <h2>Suas respostas</h2>
      </div>

      <dl className="briefing-review-list">
        {STEPS.filter((s) => s.n < STEP_COUNT).map((s) => {
          const given = answers[String(s.n)] ?? {};
          const filled = s.fields.filter((f) => !isBlank(given[f.name]));

          return (
            <div key={s.n} className="briefing-review-item">
              <div className="briefing-review-title">
                <dt>
                  {s.n}. {s.title}
                </dt>
                <button
                  type="button"
                  onClick={() => onEdit(s.n)}
                  className="briefing-edit"
                >
                  Editar
                </button>
              </div>

              {filled.length === 0 ? (
                <dd className="briefing-empty">Não informado</dd>
              ) : (
                filled.map((f) => (
                  <dd key={f.name} className="briefing-answer">
                    <span>{f.label}: </span>
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
  if (state.kind === 'idle') return <span className="briefing-save-spacer" aria-hidden="true" />;

  const text =
    state.kind === 'saving'
      ? 'Salvando…'
      : state.kind === 'saved'
        ? 'Salvo'
        : 'Sem conexão — vamos tentar de novo';

  return (
    <span
      role="status"
      className={`briefing-save briefing-save--${state.kind}`}
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
