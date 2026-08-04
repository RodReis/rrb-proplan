import { useState } from 'react';
import { toast } from 'sonner';
import { anonymizeLicense, extendLicense, type LicenseDetail } from '../../lib/api';
import { isAnonimizada } from './licensingMetrics';

/**
 * As duas ações do detalhe que mexem no que já foi decidido (SPEC-040):
 * **estender** a validade e **excluir os dados a pedido**.
 *
 * As duas exigem confirmação em formulário próprio, e não `window.prompt`: as
 * duas precisam mostrar um aviso **antes** da confirmação, e um `prompt` do
 * navegador não tem onde colocá-lo.
 */
export function LicenseDangerActions({
  licenca,
  onMudou,
}: {
  licenca: LicenseDetail;
  onMudou: () => void;
}) {
  const [aberta, setAberta] = useState<'extend' | 'anonymize' | null>(null);

  // Já anonimizada: as duas ações somem. O e-mail marcador não é destinatário
  // de nada, e "excluir de novo" não tem o que excluir.
  const anonimizada = isAnonimizada(licenca);

  return (
    <div className="mt-4 border-t border-border pt-4">
      {anonimizada ? (
        <p className="text-[12px] text-body2">
          Os dados pessoais desta licença foram excluídos a pedido do titular. A
          licença, as ativações e a trilha permanecem.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setAberta(aberta === 'extend' ? null : 'extend')}
              aria-expanded={aberta === 'extend'}
              className="rounded-[9px] border border-border2 px-3 py-1.5 text-[12px] text-body transition-colors hover:bg-card hover:text-text"
            >
              Estender validade
            </button>
            <button
              onClick={() => setAberta(aberta === 'anonymize' ? null : 'anonymize')}
              aria-expanded={aberta === 'anonymize'}
              className="rounded-[9px] border border-error/45 px-3 py-1.5 text-[12px] text-error transition-colors hover:bg-error/10"
            >
              Excluir dados a pedido
            </button>
          </div>

          {aberta === 'extend' && (
            <FormExtender
              licenca={licenca}
              onPronto={() => {
                setAberta(null);
                onMudou();
              }}
            />
          )}

          {aberta === 'anonymize' && (
            <FormAnonimizar
              licenca={licenca}
              onPronto={() => {
                setAberta(null);
                onMudou();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Estender: o aviso de sobrescrita vem **antes** da confirmação.
 *
 * `expiresAt` tem uma autoridade — a plataforma (SPEC-038). A extensão manual é
 * conserto pontual, e o próximo evento de renovação a substitui. O operador
 * precisa saber disso **antes de prometer ao cliente**, e não descobrir depois
 * que a data voltou sozinha.
 */
function FormExtender({
  licenca,
  onPronto,
}: {
  licenca: LicenseDetail;
  onPronto: () => void;
}) {
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    try {
      const r = await extendLicense(licenca.id, { until, reason });
      toast.success(
        r.previousExpiresAt
          ? `Validade estendida (antes: ${r.previousExpiresAt.slice(0, 10)})`
          : 'Validade definida',
      );
      onPronto();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível estender');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-[9px] border border-border2 bg-bg p-3.5">
      <p role="alert" className="m-0 text-[12px] leading-relaxed text-text2">
        <strong>A próxima renovação da plataforma sobrescreve esta data.</strong>{' '}
        A extensão manual é um conserto pontual — quem manda em{' '}
        <code>expiresAt</code> é a plataforma de venda. Se o cliente tem uma
        assinatura ativa, combine a mudança lá também.
      </p>

      <div className="grid gap-3 min-[720px]:grid-cols-2">
        <label className="grid gap-1 text-[12px] text-body">
          Nova validade
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[13px] text-text"
          />
          {licenca.expiresAt && (
            <span className="text-[11px] text-body2">
              Hoje vale até {licenca.expiresAt.slice(0, 10)}
            </span>
          )}
        </label>

        <label className="grid gap-1 text-[12px] text-body">
          Motivo (obrigatório)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="cortesia por suporte demorado"
            className="rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[13px] text-text"
          />
        </label>
      </div>

      <div>
        <button
          onClick={() => void confirmar()}
          // O motivo é exigido aqui E no servidor. A tela evita a ida inútil;
          // o servidor é quem garante — extensão sem motivo é a que ninguém
          // consegue explicar quando o cliente cobra o que foi prometido.
          disabled={!until || !reason.trim() || ocupado}
          className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg transition-opacity disabled:opacity-40"
        >
          {/* "Confirmar" e não "Estender validade" de novo: o botão que ABRE o
              formulário já tem esse nome, e dois controles com o mesmo rótulo na
              mesma tela é ambiguidade para quem navega por leitor de tela — que
              ouve os dois e não sabe qual executa. Um teste flagrou isto antes
              de a tela ir para o ar. */}
          Confirmar extensão
        </button>
      </div>
    </div>
  );
}

/**
 * Exclusão a pedido: **efeitos declarados antes, confirmação por digitação**.
 *
 * Ação sem volta não pode acontecer por clique errado numa lista. E descobrir
 * depois que a licença parou de receber e-mail transformaria o direito do
 * titular em incidente de suporte — por isso os efeitos vêm antes do campo.
 */
function FormAnonimizar({
  licenca,
  onPronto,
}: {
  licenca: LicenseDetail;
  onPronto: () => void;
}) {
  const [confirmacao, setConfirmacao] = useState('');
  const [reason, setReason] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const confere = confirmacao.trim().toLowerCase() === licenca.customerEmail.toLowerCase();

  async function confirmar() {
    setOcupado(true);
    try {
      const r = await anonymizeLicense(licenca.id, { reason });
      toast.success(
        `Dados excluídos — ${r.mailDeliveries} envios e ${r.webhookEvents} eventos redigidos. A licença e a trilha permanecem.`,
      );
      onPronto();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'não foi possível excluir');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 rounded-[9px] border border-error/45 bg-bg p-3.5">
      <div className="text-[12px] leading-relaxed text-text2">
        <p className="m-0">
          <strong className="text-error">Isto não tem volta.</strong> Saem o
          e-mail, o nome e o username do GitHub — da licença, dos envios e do
          conteúdo dos eventos da plataforma.
        </p>
        <p className="mb-0 mt-2">
          <strong>O que permanece:</strong> a licença, as ativações, a trilha
          completa e a referência da venda. Excluir dado pessoal não apaga o fato
          da transação — nem a prova de que esta exclusão foi feita.
        </p>
        <p className="mb-0 mt-2">
          <strong>O que deixa de funcionar:</strong> esta licença não recebe mais
          e-mail (não há destinatário) e a reemissão de chave pelo fluxo normal
          para de valer. O acesso ao código-fonte, se houver,{' '}
          <strong>continua</strong> — a compra não é desfeita.
        </p>
      </div>

      <div className="grid gap-3 min-[720px]:grid-cols-2">
        <label className="grid gap-1 text-[12px] text-body">
          Digite <code className="text-text2">{licenca.customerEmail}</code> para
          confirmar
          <input
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            autoComplete="off"
            className="rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[13px] text-text"
          />
        </label>

        <label className="grid gap-1 text-[12px] text-body">
          Motivo (obrigatório)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="pedido do titular por e-mail em 30/07"
            className="rounded-[9px] border border-border2 bg-panel px-3 py-2 text-[13px] text-text"
          />
        </label>
      </div>

      <div>
        <button
          onClick={() => void confirmar()}
          disabled={!confere || !reason.trim() || ocupado}
          className="rounded-[9px] border border-error/45 px-4 py-2 text-[12.5px] font-semibold text-error transition-opacity hover:bg-error/10 disabled:opacity-40"
        >
          Excluir os dados desta licença
        </button>
      </div>
    </div>
  );
}
