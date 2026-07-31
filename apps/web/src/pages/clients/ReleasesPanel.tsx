import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createLicRelease,
  listLicReleases,
  publishLicRelease,
  unpublishLicRelease,
  type LicProductView,
  type LicReleaseView,
} from '../../lib/api';
import { shortCivilDate } from './licensingView';
import {
  isSha256Valido,
  ordenarPorData,
  podeRegistrar,
  publishedLabel,
  publishedTone,
  shortSha,
} from './releasesView';

/**
 * Releases do produto (SPEC-041 §Escopo item 2) — **registra o ponteiro, não
 * sobe arquivo**.
 *
 * ## A pergunta que esta tela responde
 *
 * *"Qual versão o cliente licenciado recebe quando roda `war-room update`?"*
 *
 * O binário já vive na Release privada do GitHub (ADR-028). O que se registra
 * aqui é o `assetId` que o `download` troca por URL assinada e o `sha256` que a
 * máquina do cliente confere depois de baixar. **Nenhum byte passa pelo
 * ProPlan** — nem por upload, nem por download.
 *
 * ## Por que registro manual
 *
 * Decisão do PI (§Fora de escopo): publicar pelo CI do War Room exigiria um
 * token de máquina com escrita administrativa **dentro do módulo que guarda as
 * licenças**. Superfície de autenticação nova, no lugar mais sensível do
 * produto, para economizar um formulário preenchido uma vez por versão.
 *
 * ## "Despublicada" não é "apagada"
 *
 * Despublicar tira a release do `check` **e** do `download`, sem apagar a linha:
 * a trilha de quem já baixou aponta para ela, e o artefato segue no GitHub.
 * Chamar isso de "remover" faria o operador acreditar que o binário saiu de
 * circulação — o mesmo tipo de mentira que o painel de source é proibido de
 * contar sobre o clone que permanece.
 */

const OS_PILOTO = 'win-x64';

export function ReleasesPanel({ produtos }: { produtos: LicProductView[] }) {
  const [releases, setReleases] = useState<LicReleaseView[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const [form, setForm] = useState({
    productId: produtos[0]?.id ?? '',
    version: '',
    os: OS_PILOTO,
    releasedAt: '',
    assetId: '',
    sha256: '',
    notes: '',
  });

  async function carregar() {
    setCarregando(true);
    try {
      setReleases(ordenarPorData(await listLicReleases()));
    } catch {
      toast.error('Não foi possível carregar as releases');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  async function registrar() {
    setSalvando(true);
    try {
      const criada = await createLicRelease({
        productId: form.productId,
        version: form.version.trim(),
        os: form.os.trim(),
        // `datetime-local`/`date` devolve sem fuso; o servidor exige data
        // válida. Converter aqui mantém o que o operador digitou.
        releasedAt: new Date(form.releasedAt).toISOString(),
        assetId: form.assetId.trim(),
        sha256: form.sha256.trim(),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });

      setReleases((atual) => ordenarPorData([criada, ...atual]));
      setForm((f) => ({
        ...f,
        version: '',
        releasedAt: '',
        assetId: '',
        sha256: '',
        notes: '',
      }));
      setAberto(false);
      toast.success(`Release ${criada.version} registrada`);
    } catch (erro) {
      // A mensagem do servidor é a que nomeia o campo errado — engoli-la
      // devolveria "erro ao salvar" sobre um "o hash tem 63 dígitos".
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível registrar');
    } finally {
      setSalvando(false);
    }
  }

  async function alternar(release: LicReleaseView) {
    try {
      const nova = release.published
        ? await unpublishLicRelease(release.id)
        : await publishLicRelease(release.id);

      // Substitui a linha e reordena: a resposta traz só a alterada, e sem
      // reordenar ela saltaria de posição na lista.
      setReleases((atual) =>
        ordenarPorData(atual.map((r) => (r.id === nova.id ? nova : r))),
      );
      toast.success(
        nova.published
          ? `Release ${nova.version} republicada`
          : `Release ${nova.version} despublicada — some do update dos clientes`,
      );
    } catch {
      toast.error('Não foi possível alterar a publicação');
    }
  }

  const shaPreenchidoEInvalido =
    form.sha256.trim() !== '' && !isSha256Valido(form.sha256);

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="m-0 text-[13.5px] font-semibold text-text">
            Versões publicadas
          </h3>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-body">
            O que a máquina licenciada recebe ao procurar atualização. O
            instalador fica na Release privada do GitHub — aqui se registra o
            ponteiro para ele, não o arquivo.
          </p>
        </div>
        <button
          onClick={() => setAberto((v) => !v)}
          disabled={produtos.length === 0}
          className="shrink-0 rounded-[9px] bg-btnbg px-3 py-1.5 text-[12px] font-semibold text-btnfg disabled:opacity-50"
        >
          {aberto ? 'Cancelar' : 'Registrar versão'}
        </button>
      </div>

      {aberto && (
        <div className="mt-4 grid gap-3 rounded-[10px] border border-border p-4">
          <label className="grid gap-1 text-[12px] text-body">
            Produto
            <select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
            >
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] text-body">
              Versão
              <input
                value={form.version}
                onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                placeholder="1.2.0"
                className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
              />
            </label>
            <label className="grid gap-1 text-[12px] text-body">
              Plataforma
              <input
                value={form.os}
                onChange={(e) => setForm((f) => ({ ...f, os: e.target.value }))}
                className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
              />
            </label>
          </div>

          <label className="grid gap-1 text-[12px] text-body">
            Data de publicação
            <input
              type="date"
              value={form.releasedAt}
              onChange={(e) => setForm((f) => ({ ...f, releasedAt: e.target.value }))}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
            />
            {/* **A data é informada, nunca "hoje" por omissão.** É ela que
                decide quem tem direito à versão: uma release antiga registrada
                com a data de hoje ficaria autorizada para quem já tem a janela
                de updates vencida. */}
            <span className="text-[11px] text-body">
              Quando a versão saiu de verdade — é ela que decide quais licenças
              têm direito a esta atualização.
            </span>
          </label>

          <label className="grid gap-1 text-[12px] text-body">
            ID do asset no GitHub
            <input
              value={form.assetId}
              onChange={(e) => setForm((f) => ({ ...f, assetId: e.target.value }))}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
            />
          </label>

          <label className="grid gap-1 text-[12px] text-body">
            SHA-256 do arquivo
            <input
              value={form.sha256}
              onChange={(e) => setForm((f) => ({ ...f, sha256: e.target.value }))}
              placeholder="64 caracteres hexadecimais"
              aria-invalid={shaPreenchidoEInvalido}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 font-mono text-[12px] text-text"
            />
            {shaPreenchidoEInvalido && (
              // Avisar aqui, e não depois do POST: hash torto aceito pelos dois
              // lados só apareceria na máquina do cliente, depois de 80 MB
              // baixados, como "download corrompido".
              <span className="text-[11px] text-danger">
                O hash precisa ter 64 dígitos hexadecimais.
              </span>
            )}
          </label>

          <label className="grid gap-1 text-[12px] text-body">
            Notas da versão (opcional)
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text"
            />
          </label>

          <div>
            <button
              onClick={() => void registrar()}
              disabled={salvando || !podeRegistrar(form)}
              className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg disabled:opacity-50"
            >
              {salvando ? 'Registrando…' : 'Registrar versão'}
            </button>
          </div>
        </div>
      )}

      {carregando ? (
        <p className="mt-4 text-[12px] text-body">Carregando…</p>
      ) : releases.length === 0 ? (
        <p className="mt-4 max-w-[62ch] text-[12px] leading-relaxed text-body">
          Nenhuma versão registrada. Enquanto não houver, o
          {' '}<code className="font-mono text-[11.5px]">update</code>{' '}
          responde que não há atualização — mesmo que exista release no GitHub.
        </p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {releases.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-text">
                    {r.version}
                  </span>
                  <span className="text-[11.5px] text-body">{r.os}</span>
                  <span
                    className={
                      'rounded-[6px] border px-1.5 py-0.5 text-[10.5px] ' +
                      (publishedTone(r) === 'ok'
                        ? 'border-accentBorder text-text2'
                        : 'border-border text-body')
                    }
                  >
                    {publishedLabel(r)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-body">
                  {/* `shortCivilDate`, não `shortDate`: a data de publicação é
                      civil (o dia digitado, meia-noite UTC). Lida como
                      instante, ela volta um dia atrás em fuso negativo — o
                      FIX #228. */}
                  <span>{shortCivilDate(r.releasedAt)}</span>
                  {/* O hash completo no `title`: conferir hash é comparar
                      caractere a caractere, e uma tela que só mostra 12 deles
                      torna a conferência impossível. */}
                  <code className="font-mono" title={r.sha256}>
                    {shortSha(r.sha256)}
                  </code>
                </div>
              </div>

              <button
                onClick={() => void alternar(r)}
                className="shrink-0 rounded-[8px] border border-border px-3 py-1.5 text-[12px] text-text"
              >
                {r.published ? 'Despublicar' : 'Republicar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
