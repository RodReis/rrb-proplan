import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createLicRelease,
  listLicReleases,
  publishLicRelease,
  unpublishLicRelease,
  updateLicRelease,
  type LicProductView,
  type LicReleaseView,
} from '../../lib/api';
import { MarkdownView } from '../workspace/MarkdownView';
import { shortCivilDate } from './licensingView';
import {
  camposAlterados,
  isSha256Valido,
  normalizarHeadings,
  ordenarPorData,
  paraInputDate,
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
  /**
   * A release sendo corrigida, ou `null` para "registrando uma nova".
   *
   * **Um formulário só, dois modos** (FIX #242). Uma segunda tela de edição
   * duplicaria as mesmas regras de validação em dois lugares, e elas divergiriam
   * na primeira mudança — que é como o `assetId` errado passou.
   */
  const [editando, setEditando] = useState<LicReleaseView | null>(null);

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
      fechar();
      avisarDoAsset(criada, `Release ${criada.version} registrada`);
    } catch (erro) {
      // A mensagem do servidor é a que nomeia o campo errado — engoli-la
      // devolveria "erro ao salvar" sobre um "o hash tem 63 dígitos".
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível registrar');
    } finally {
      setSalvando(false);
    }
  }

  /** Abre o formulário preenchido com o que está gravado. */
  function editar(release: LicReleaseView) {
    setForm({
      productId: release.productId,
      version: release.version,
      os: release.os,
      // `paraInputDate`, não `slice(0, 10)` do ISO: ver o comentário do helper —
      // salvar sem tocar na data não pode gravar o dia anterior.
      releasedAt: paraInputDate(release.releasedAt),
      assetId: release.assetId,
      sha256: release.sha256,
      notes: release.notes ?? '',
    });
    setEditando(release);
    setAberto(true);
  }

  function fechar() {
    setAberto(false);
    setEditando(null);
    setForm((f) => ({
      ...f,
      version: '',
      releasedAt: '',
      assetId: '',
      sha256: '',
      notes: '',
    }));
  }

  /**
   * Salva a correção — só o que mudou (FIX #242).
   *
   * Sem esta rota, um `assetId` errado só saía por SQL: não havia edição, e
   * recadastrar esbarra no `@@unique` da versão. Foi o que aconteceu com a
   * `1.0.1` do War Room.
   */
  async function corrigir(release: LicReleaseView) {
    const mudou = camposAlterados(form, release);
    if (Object.keys(mudou).length === 0) {
      // O servidor recusaria com "nada para alterar", mas dizer aqui evita a ida
      // e volta e nomeia o que aconteceu: nada foi alterado, e nada quebrou.
      toast.info('Nenhum campo foi alterado');
      return;
    }

    setSalvando(true);
    try {
      const nova = await updateLicRelease(release.id, mudou);

      setReleases((atual) =>
        ordenarPorData(atual.map((r) => (r.id === nova.id ? nova : r))),
      );
      fechar();
      avisarDoAsset(nova, `Release ${nova.version} corrigida`);
    } catch (erro) {
      // A mensagem do servidor nomeia o campo — engoli-la devolveria "erro ao
      // salvar" sobre um "esse asset não existe na Release do GitHub".
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível corrigir');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * O desfecho da conferência do asset, junto do "salvo".
   *
   * **Conferido**: mostra o nome do arquivo. Três assets vizinhos na mesma
   * Release (`.exe`, `.zip`, `SHA256SUMS.txt`) têm ids parecidos — ver qual foi
   * registrado é o que denuncia o `.zip` no lugar do instalador. O ProPlan não
   * decide qual é o certo (ADR-014); mostra o que o operador escolheu.
   *
   * **Não conferido**: diz que não conferiu, e por quê. Calar aqui deixaria o
   * operador achar que o id foi validado quando ninguém olhou.
   */
  function avisarDoAsset(release: LicReleaseView, titulo: string) {
    if (release.asset?.checked) {
      toast.success(`${titulo} — asset conferido: ${release.asset.name}`);
      return;
    }
    if (release.asset) {
      toast.warning(`${titulo}, mas o asset não foi conferido: ${release.asset.reason}`);
      return;
    }
    toast.success(titulo);
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
          onClick={() => (aberto ? fechar() : setAberto(true))}
          disabled={produtos.length === 0}
          className="shrink-0 rounded-[9px] bg-btnbg px-3 py-1.5 text-[12px] font-semibold text-btnfg disabled:opacity-50"
        >
          {aberto ? 'Cancelar' : 'Registrar versão'}
        </button>
      </div>

      {aberto && (
        <div className="mt-4 grid gap-3 rounded-[10px] border border-border p-4">
          {editando && (
            /* **Por que produto, versão e plataforma ficam travados.** Os três
               são a identidade da linha, e a trilha de quem já baixou aponta
               para ela: trocá-los faria downloads antigos ficarem pendurados
               num registro que passou a descrever outra coisa. Dizer isso na
               tela evita que o campo cinza pareça defeito. */
            <p className="m-0 rounded-[8px] border border-accentBorder px-3 py-2 text-[11.5px] leading-relaxed text-body">
              Corrigindo <strong className="text-text">{editando.version}</strong>{' '}
              ({editando.os}). Produto, versão e plataforma identificam a release
              e não mudam — para trocá-los, registre outra versão e despublique
              esta.
            </p>
          )}

          <label className="grid gap-1 text-[12px] text-body">
            Produto
            <select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              disabled={editando !== null}
              className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text disabled:opacity-60"
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
                disabled={editando !== null}
                className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text disabled:opacity-60"
              />
            </label>
            <label className="grid gap-1 text-[12px] text-body">
              Plataforma
              <input
                value={form.os}
                onChange={(e) => setForm((f) => ({ ...f, os: e.target.value }))}
                disabled={editando !== null}
                className="rounded-[8px] border border-border bg-panel px-2 py-1.5 text-[12.5px] text-text disabled:opacity-60"
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
              <span className="text-[11px] text-error">
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => void (editando ? corrigir(editando) : registrar())}
              disabled={salvando || !podeRegistrar(form)}
              className="rounded-[9px] bg-btnbg px-4 py-2 text-[12.5px] font-semibold text-btnfg disabled:opacity-50"
            >
              {salvando
                ? editando
                  ? 'Salvando…'
                  : 'Registrando…'
                : editando
                  ? 'Salvar correção'
                  : 'Registrar versão'}
            </button>
            {editando && (
              <button
                onClick={fechar}
                className="rounded-[9px] border border-border px-3 py-2 text-[12.5px] text-text"
              >
                Cancelar
              </button>
            )}
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
              className="rounded-[10px] border border-border px-3.5 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* A versão é o nome próprio da linha: é por ela que o
                        operador procura quando o cliente diz "estou na 1.0.0".
                        Ganha o degrau de tamanho que tinha faltando. */}
                    <span className="text-[14px] font-semibold tracking-tight text-text">
                      {r.version}
                    </span>
                    <code className="rounded-[5px] border border-border2 px-1.5 py-0.5 font-mono text-[10.5px] text-body">
                      {r.os}
                    </code>
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
                  {/* `shortCivilDate`, não `shortDate`: a data de publicação é
                      civil (o dia digitado, meia-noite UTC). Lida como
                      instante, ela volta um dia atrás em fuso negativo — o
                      FIX #228. */}
                  <p className="mt-1 text-[11.5px] text-body">
                    Publicada em {shortCivilDate(r.releasedAt)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* **Editar existe para a despublicada também** — e é o caso
                      principal: quem despublicou tentando contornar um cadastro
                      errado ficaria sem saída, porque recadastrar esbarra no
                      unique da versão. Foi o beco do FIX #242. */}
                  <button
                    onClick={() => editar(r)}
                    className="rounded-[8px] border border-border px-3 py-1.5 text-[12px] text-text transition-colors hover:border-border2"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => void alternar(r)}
                    className="rounded-[8px] border border-border px-3 py-1.5 text-[12px] text-text transition-colors hover:border-border2"
                  >
                    {r.published ? 'Despublicar' : 'Republicar'}
                  </button>
                </div>
              </div>

              {/* **As notas primeiro, os identificadores depois.** A pergunta que
                  se faz olhando uma versão é *"o que mudou nela?"* — e a resposta
                  estava escondida no banco enquanto a linha exibia o hash, que
                  ninguém lê de cabeça. Ordem por frequência de uso, não por ordem
                  das colunas. */}
              {r.notes && (
                <div className="mt-3 rounded-[9px] border border-border2 bg-bg px-3.5 py-3">
                  <h4 className="m-0 mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-body">
                    Notas da versão
                  </h4>
                  {/* `MarkdownView` é o renderizador do produto inteiro
                      (Documentos, Handoff): as notas vêm coladas da Release do
                      GitHub, com títulos e listas, e exibi-las como texto cru
                      mostraria `##` e `-` na cara do operador.

                      `prose-compact` reduz a escala do `prose-doc`, que é feita
                      para markdown-como-página: sem ela, um `#` do changelog
                      vira 24px e fica maior que a versão que titula o item. */}
                  <div className="prose-compact max-h-[260px] overflow-y-auto">
                    <MarkdownView markdown={normalizarHeadings(r.notes)} />
                  </div>
                </div>
              )}

              {/* Os identificadores no rodapé, em mono: são para **conferir**,
                  não para ler. O hash completo fica no `title` porque comparar
                  hash é caractere a caractere, e uma tela que mostra 12 deles
                  torna a conferência impossível. */}
              <dl className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <dt className="text-body">asset</dt>
                  <dd className="m-0 font-mono text-body2">{r.assetId}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-body">sha-256</dt>
                  <dd className="m-0 font-mono text-body2" title={r.sha256}>
                    {shortSha(r.sha256)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
