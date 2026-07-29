import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  getContractTemplate,
  getProviderProfile,
  listContractTemplates,
  saveContractTemplateVersion,
  saveProviderProfile,
  type ContractModality,
  type ProviderProfileView,
  type TemplateDetail,
  type TemplateSummary,
} from '../../lib/api';
import { ClientsShell } from './ClientsShell';
import {
  isValidProfile,
  modalityLabel,
  PLACEHOLDERS,
  shortDateTime,
} from './contractsView';

type Aba = 'perfil' | 'templates';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

interface PerfilForm {
  legalName: string;
  documentType: 'cpf' | 'cnpj';
  document: string;
  zipCode: string;
  street: string;
  district: string;
  city: string;
  state: string;
  email: string;
  phone: string;
}

const CAMPOS_PERFIL: {
  key: keyof Omit<PerfilForm, 'documentType'>;
  label: string;
  required?: boolean;
}[] = [
  { key: 'legalName', label: 'Nome ou razão social', required: true },
  { key: 'document', label: 'CPF / CNPJ', required: true },
  { key: 'zipCode', label: 'CEP' },
  { key: 'street', label: 'Logradouro' },
  { key: 'district', label: 'Bairro' },
  { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'Estado' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefone' },
];

function formDoPerfil(p: ProviderProfileView): PerfilForm {
  return {
    legalName: p.legalName,
    documentType: p.documentType,
    document: p.document,
    zipCode: p.zipCode ?? '',
    street: p.street ?? '',
    district: p.district ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
  };
}

/**
 * Perfil do prestador e templates de contrato (SPEC-034 §2.1 a §2.3).
 *
 * **Página de workspace, não gaveta de projeto.** Os dois dados são **um por
 * tenant**: abrir pelo projeto A e pelo projeto B editaria a mesma coisa, e a
 * tela sugeriria uma configuração por projeto que não existe.
 *
 * **Só o `owner` escreve** — e quem resolve isso é o servidor, que devolve
 * `canEdit` em ambos os payloads. A tela obedece ao que recebe em vez de
 * recalcular o papel: esconder o botão é conveniência, a barreira é o 403.
 */
export function ContractSettingsPage() {
  const { tenant = '' } = useParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [aba, setAba] = useState<Aba>('perfil');

  const [perfil, setPerfil] = useState<ProviderProfileView | null>(null);
  const [form, setForm] = useState<PerfilForm | null>(null);

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [modalidade, setModalidade] = useState<ContractModality>('desenvolvimento');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [corpo, setCorpo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [p, lista] = await Promise.all([
        getProviderProfile(),
        listContractTemplates(),
      ]);
      setPerfil(p);
      setForm(formDoPerfil(p));
      setTemplates(lista);
      setState({ status: 'ready' });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'falha ao carregar',
      });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O corpo do template só é buscado ao abrir a aba: são 3 modalidades e cada
  // uma traz um texto longo, que ninguém lê antes de escolher qual editar.
  useEffect(() => {
    if (aba !== 'templates') return;
    let ativo = true;
    void (async () => {
      try {
        const detalhe = await getContractTemplate(modalidade);
        if (!ativo) return;
        setTemplate(detalhe);
        setCorpo(detalhe.body);
      } catch (err) {
        if (!ativo) return;
        toast.error(err instanceof Error ? err.message : 'falha ao carregar o template');
      }
    })();
    return () => {
      ativo = false;
    };
  }, [aba, modalidade]);

  async function salvarPerfil() {
    if (!form) return;
    setOcupado(true);
    try {
      const salvo = await saveProviderProfile({
        legalName: form.legalName,
        documentType: form.documentType,
        document: form.document,
        zipCode: form.zipCode,
        street: form.street,
        district: form.district,
        city: form.city,
        state: form.state,
        email: form.email,
        phone: form.phone,
      });
      setPerfil(salvo);
      setForm(formDoPerfil(salvo));
      toast.success('Perfil do prestador salvo');
    } catch (err) {
      // Sem isto, uma recusa do servidor deixaria a tela igual e a pessoa
      // acharia que salvou.
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  async function salvarTemplate() {
    setOcupado(true);
    try {
      const salvo = await saveContractTemplateVersion(modalidade, corpo);
      setTemplate(salvo);
      setCorpo(salvo.body);
      setTemplates(await listContractTemplates());
      toast.success(`Versão ${salvo.currentVersion} salva`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível salvar');
    } finally {
      setOcupado(false);
    }
  }

  const resumo = templates.find((t) => t.modality === modalidade);
  const podeSalvarPerfil =
    !!form && isValidProfile(form) && (perfil?.canEdit ?? false) && !ocupado;

  return (
    <ClientsShell
      tenant={tenant}
      title="Contratos"
      subtitle="Perfil do prestador e os modelos de contrato do workspace."
    >
      {state.status === 'loading' && (
        <p className="text-[13px] text-body">Carregando…</p>
      )}

      {state.status === 'error' && (
        <p className="text-[13px] text-danger">{state.message}</p>
      )}

      {state.status === 'ready' && (
        <>
          <div role="tablist" className="flex gap-1.5">
            {(['perfil', 'templates'] as const).map((chave) => (
              <button
                key={chave}
                role="tab"
                aria-selected={aba === chave}
                onClick={() => setAba(chave)}
                className={
                  'rounded-[9px] px-3.5 py-1.5 text-[12.5px] transition-colors duration-150 ' +
                  (aba === chave
                    ? 'bg-card font-semibold text-text'
                    : 'text-body2 hover:bg-card hover:text-text')
                }
              >
                {chave === 'perfil' ? 'Perfil do prestador' : 'Modelos de contrato'}
              </button>
            ))}
          </div>

          {aba === 'perfil' && form && (
            <section className="rounded-[14px] border border-border bg-panel p-5">
              {!perfil?.exists && (
                <p className="mb-4 rounded-[9px] border border-accent-border bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-text2">
                  Este perfil identifica você como parte no contrato. Sem ele, a
                  emissão é recusada.
                </p>
              )}

              {!perfil?.canEdit && (
                <p className="mb-4 text-[12.5px] text-body">
                  Só o dono do workspace altera o perfil do prestador.
                </p>
              )}

              <fieldset
                disabled={!perfil?.canEdit || ocupado}
                className="grid grid-cols-2 gap-3.5 max-[720px]:grid-cols-1"
              >
                <label className="grid gap-1.5">
                  <span className="text-[11.5px] text-body">Tipo de documento</span>
                  <select
                    value={form.documentType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        documentType: e.target.value as 'cpf' | 'cnpj',
                      })
                    }
                    className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                  >
                    <option value="cnpj">CNPJ</option>
                    <option value="cpf">CPF</option>
                  </select>
                </label>

                {CAMPOS_PERFIL.map(({ key, label, required }) => (
                  <label key={key} className="grid gap-1.5">
                    <span className="text-[11.5px] text-body">
                      {label}
                      {required && <span className="text-danger"> *</span>}
                    </span>
                    <input
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="rounded-[8px] border border-border2 bg-bg px-3 py-2 text-[13px] text-text"
                    />
                  </label>
                ))}
              </fieldset>

              {perfil?.canEdit && (
                <button
                  type="button"
                  disabled={!podeSalvarPerfil}
                  onClick={() => void salvarPerfil()}
                  className="mt-4 rounded-[8px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-50"
                >
                  Salvar perfil
                </button>
              )}
            </section>
          )}

          {aba === 'templates' && (
            <section className="grid gap-4">
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.modality}
                    onClick={() => setModalidade(t.modality)}
                    className={
                      'rounded-[9px] border px-3 py-1.5 text-[12px] transition-colors duration-150 ' +
                      (modalidade === t.modality
                        ? 'border-accent-border bg-accent-soft font-semibold text-text'
                        : 'border-border2 text-body2 hover:bg-card hover:text-text')
                    }
                  >
                    {modalityLabel(t.modality)}
                    {/* O espaço é do TEXTO, não só do `ml-1.5`: sem ele o nome
                        acessível sai "Desenvolvimento· exemplo" colado, e um
                        leitor de tela lê as duas palavras como uma. */}
                    {t.isSeedExample && (
                      <span className="ml-1.5 text-dim"> · exemplo</span>
                    )}
                  </button>
                ))}
              </div>

              {resumo?.isSeedExample && (
                <p className="rounded-[9px] border border-accent-border bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-text2">
                  Este é o texto de exemplo que veio com o produto.{' '}
                  <strong>Edite e salve antes de emitir o primeiro contrato</strong>{' '}
                  desta modalidade — o ProPlan não emite contrato com texto que o
                  dono nunca leu.
                </p>
              )}

              <p className="text-[12px] text-body">
                Versão atual: <strong>{resumo?.currentVersion ?? '—'}</strong> ·
                alterada em {shortDateTime(resumo?.updatedAt ?? null)}. Salvar{' '}
                <strong>cria uma versão nova</strong>; a anterior continua legível,
                e um contrato já emitido não muda.
              </p>

              <details className="rounded-[9px] border border-border2 px-3.5 py-2.5">
                <summary className="cursor-pointer text-[12px] text-body2">
                  Campos que o contrato preenche ({PLACEHOLDERS.length})
                </summary>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <code
                      key={p}
                      className="rounded-[6px] border border-border2 px-1.5 py-0.5 font-mono text-[11px] text-body2"
                    >{`{{${p}}}`}</code>
                  ))}
                </div>
              </details>

              <textarea
                value={corpo}
                disabled={!template?.canEdit || ocupado}
                onChange={(e) => setCorpo(e.target.value)}
                rows={22}
                spellCheck={false}
                aria-label={`Corpo do template de ${modalityLabel(modalidade)}`}
                className="w-full rounded-[10px] border border-border2 bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-text"
              />

              {!template?.canEdit && (
                <p className="text-[12.5px] text-body">
                  Só o dono do workspace altera os modelos de contrato.
                </p>
              )}

              {template?.canEdit && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={ocupado || corpo.trim() === ''}
                    onClick={() => void salvarTemplate()}
                    className="rounded-[8px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-[filter] duration-150 hover:brightness-110 disabled:opacity-50"
                  >
                    Salvar como versão nova
                  </button>
                  <span className="text-[11.5px] text-body">
                    Contratos já emitidos continuam com o texto de origem.
                  </span>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </ClientsShell>
  );
}
