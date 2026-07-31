import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, SessionUser } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useTheme } from '../theme';

interface Props {
  user: SessionUser;
  onLogout: () => void;
}

/**
 * Configurações (SPEC-025 §1) — rota `/settings`, fora do shell de workspace.
 *
 * Página, não modal: desconectado não existe workspace de onde abrir o modal, e
 * é justamente aí que o usuário precisa chegar às Configurações. O modal antigo
 * (`Settings.tsx`, dentro do workspace) segue vivo para as opções de IA — esta
 * página cobre as seções que a spec pede em Tema e Conta/Identidade.
 *
 * A distinção central da spec mora aqui: **Desconectar GitHub** (vermelho,
 * revoga a conexão) × **Sair da conta** (neutro, encerra a sessão). São ações
 * diferentes com consequências diferentes, e a UI não pode deixar confundir.
 */
export function SettingsPage({ user, onLogout }: Props) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    api
      .githubConnection()
      .then(({ connected }) => setConnected(connected))
      .catch(() => setConnected(null));
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api.disconnectGithub();
      setConnected(false);
      setConfirmDisconnect(false);
      toast.success('GitHub desconectado. Sua conta continua ativa.');
      // Destino pós-desconexão é o Catálogo (spec §3) — de onde se reconecta.
      navigate('/');
    } catch (err) {
      toast.error(`Não foi possível desconectar: ${String(err)}`);
    } finally {
      setDisconnecting(false);
    }
  }

  const dark = theme === 'carbono';

  return (
    // Dentro do `AppShell`, como as demais telas (correção do PI, 2026-07-31).
    // Antes montava o próprio `<div>` com um header só dela: sem menu lateral,
    // sem topbar, sem tema — quem chegava aqui perdia a navegação e só voltava
    // pelo link "← Catálogo". O shell traz os três de graça, e o item
    // "Configuração" do menu passa a acender quando a tela está aberta.
    <AppShell user={user} section="Configuração" onLogout={onLogout}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-7 px-7 pb-16 pt-7 max-[720px]:px-4">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em]">
              Configurações
            </h1>
            <p className="mt-1 max-w-[70ch] text-[13px] text-body">
              Preferências desta conta e o que o ProPlan acessa em seu nome.
            </p>
          </div>

          <Section
            title="Tema"
            description="Carbono (escuro) ou Claro. A escolha vale para todo o painel."
            etiqueta={<Etiqueta tom="neutro">{dark ? 'carbono' : 'claro'}</Etiqueta>}
          >
            <button
              onClick={toggle}
              className="flex h-9 items-center gap-2 rounded-[9px] border border-border2 px-4 text-[12.5px] font-medium text-body transition-colors duration-150 hover:border-hoverb hover:text-text"
            >
              {dark ? 'Mudar para o tema Claro' : 'Mudar para o tema Carbono'}
            </button>
          </Section>

          <Section
            title="Conta"
            description="Quem você é no ProPlan. A identidade vem do provedor de login e é independente das conexões."
          >
            <div className="flex items-center gap-3 rounded-[12px] border border-border2 bg-surface px-4 py-3">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-9 w-9 rounded-full border border-border2"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-xs font-semibold text-body2">
                  {(user.name ?? user.login).charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-medium">
                  {user.name ?? user.login}
                </span>
                <span className="truncate font-mono text-[11px] text-muted">
                  @{user.login}
                </span>
              </span>
            </div>

            <button
              onClick={onLogout}
              className="mt-3 flex h-9 items-center rounded-[9px] border border-border2 px-4 text-[12.5px] font-medium text-body transition-colors duration-150 hover:border-hoverb hover:text-text"
            >
              Sair da conta
            </button>
          </Section>

          <Section
            title="Conexões"
            description="O que o ProPlan acessa em seu nome. Desconectar revoga o acesso sem encerrar sua conta — seus projetos ficam somente leitura até você reconectar."
            etiqueta={
              connected === null ? undefined : (
                <Etiqueta tom={connected ? 'ok' : 'erro'}>
                  {connected ? 'github conectado' : 'github desconectado'}
                </Etiqueta>
              )
            }
          >
            <div className="flex items-center gap-3 rounded-[12px] border border-border2 bg-surface px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-medium">GitHub</span>
                <span className="truncate text-[11px] text-muted">
                  {connected === null
                    ? 'Verificando…'
                    : connected
                      ? 'Conectado · leitura de documentação e escrita como proplan[bot]'
                      : 'Desconectado'}
                </span>
              </span>
              {connected === false && (
                <a
                  href={api.loginUrl}
                  className="flex h-9 shrink-0 items-center rounded-[9px] border px-4 text-[12.5px] font-medium transition-[filter] duration-150 hover:brightness-110"
                  style={{
                    borderColor: 'var(--accentBorder)',
                    background: 'color-mix(in srgb, var(--pop) 60%, transparent)',
                  }}
                >
                  Conectar GitHub
                </a>
              )}
              {connected === true && (
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  className="h-9 shrink-0 rounded-[9px] border border-error/40 px-4 text-[12.5px] font-medium text-error transition-colors duration-150 hover:border-error hover:bg-error/10"
                >
                  Desconectar GitHub
                </button>
              )}
            </div>

            {/* A spec (§6) pede que as três ações confundíveis se distingam na
                tela — desinstalar o App é ato do dono no github.com, não nosso. */}
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint">
              Desconectar revoga a autorização e mantém sua conta. Para{' '}
              <strong className="font-medium text-muted">
                deixar de gerenciar um repositório
              </strong>{' '}
              (só o índice local), use o botão no card dele, no Catálogo. Para{' '}
              <strong className="font-medium text-muted">
                desinstalar o GitHub App
              </strong>
              , acesse{' '}
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                as instalações no github.com
              </a>
              .
            </p>
          </Section>
        </div>
      </div>

      {confirmDisconnect && (
        <ConfirmDialog
          title="Desconectar do GitHub?"
          message="O ProPlan deixa de acessar seus repositórios: nenhuma leitura ou escrita acontece em seu nome, e os projetos ficam somente leitura. Sua conta continua ativa — isto não é sair. Nada é apagado no GitHub, e reconectar traz tudo de volta sem reinstalar o App."
          confirmLabel={disconnecting ? 'Desconectando…' : 'Desconectar GitHub'}
          danger
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </AppShell>
  );
}

/**
 * Cartão de seção — o mesmo objeto do `Cartao` das telas de licenciamento
 * (borda `--border`, fundo `--panel`, raio 14). Antes eram títulos soltos sobre
 * o fundo da página, e a tela não parecia do mesmo produto que as vizinhas.
 *
 * `etiqueta` mostra o estado à direita do título, como em Licenças: numa tela
 * de configuração o estado atual é a informação principal, e lê-lo no meio de
 * uma frase é mais lento que vê-lo como badge.
 */
function Section({
  title,
  description,
  etiqueta,
  children,
}: {
  title: string;
  description: string;
  etiqueta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold text-text">{title}</h2>
        {etiqueta}
      </div>
      <p className="m-0 mt-1 max-w-[72ch] text-[12px] leading-relaxed text-body2">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A mesma etiqueta das telas de licenciamento, para "conectado" significar o
 *  mesmo em toda parte. */
function Etiqueta({
  tom,
  children,
}: {
  tom: 'ok' | 'erro' | 'neutro';
  children: React.ReactNode;
}) {
  const cor =
    tom === 'ok'
      ? 'border-success/40 bg-success/10 text-success'
      : tom === 'erro'
        ? 'border-error/45 bg-error/10 text-error'
        : 'border-border2 bg-card text-body2';
  const ponto =
    tom === 'ok' ? 'bg-success' : tom === 'erro' ? 'bg-error' : 'bg-border2';

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-px font-mono text-[10px] uppercase tracking-[0.06em] ${cor}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ponto}`} />
      {children}
    </span>
  );
}
