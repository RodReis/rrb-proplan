import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, SessionUser } from '../lib/api';
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
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex h-[60px] shrink-0 items-center gap-3.5 border-b border-border bg-panel px-7">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-[13px] text-muted transition-colors duration-150 hover:text-text"
        >
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Catálogo
        </button>
        <span className="text-border2">/</span>
        <span className="text-[13px] font-semibold">Configurações</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[720px] flex-col gap-7 px-8 pb-16 pt-9">
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.01em]">
            Configurações
          </h1>

          <Section
            title="Tema"
            description="Carbono (escuro) ou Claro. A escolha vale para todo o painel."
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
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-muted">
        {description}
      </p>
      {children}
    </section>
  );
}
