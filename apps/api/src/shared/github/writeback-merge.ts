import { GithubWritebackClient, WritebackConflictError } from './github-writeback.client';

/**
 * Escrita de arquivo com **merge re-aplicado no retry**.
 *
 * O padrão ler-mesclar-reescrever aparece em todo write-back que edita um
 * documento existente (`.proplan/config.yml`, `docs/CONTEXT.md`). O bug que
 * este helper existe para matar (achado no code review da Fatia 10): cada call
 * site computava o conteúdo **uma vez, antes do loop**, e no retry re-lia só o
 * `baseSha` — re-enviando o merge de um snapshot velho. Uma edição feita à mão
 * no GitHub entre o snapshot e o retry era **silenciosamente sobrescrita**.
 *
 * O contrato do `ARCHITECTURE.md` → Resiliência é *"409 → re-sync, reaplicar
 * mudança, um retry"*. **Reaplicar**, não re-enviar: por isso `mutate` é uma
 * função, chamada de novo a cada tentativa sobre o conteúdo **vivo**.
 *
 * Não serve a quem **gera** o arquivo inteiro (projeção, handoff) nem a quem
 * promove conteúdo que o humano revisou (`tabs.promote`): lá não há merge a
 * reaplicar, e sobrescrever é o comportamento correto.
 */
export async function putFileWithMerge(params: {
  writeback: GithubWritebackClient;
  token: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  /**
   * Aplica a mudança sobre o conteúdo atual do arquivo (null = não existe).
   * Chamada a cada tentativa — deve ser pura em relação ao que recebe.
   */
  mutate: (currentContent: string | null) => string;
}): Promise<string> {
  const { writeback, token, owner, repo, path, branch, message, mutate } = params;

  for (let attempt = 0; attempt < 2; attempt++) {
    /**
     * Conteúdo **e** sha do mesmo GET, sempre: eles têm que vir do mesmo
     * instante. Usar um cache local do conteúdo com o sha vivo reintroduz o
     * bug por outro caminho — o PUT casa (o sha está certo), não há 409, e o
     * merge sai calculado sobre o conteúdo velho. A edição concorrente morre
     * sem nem um conflito para avisar.
     */
    const live = await writeback.getFile(token, owner, repo, path, branch);

    try {
      return await writeback.putFile({
        token,
        owner,
        repo,
        path,
        branch,
        content: mutate(live?.content ?? null),
        message,
        baseSha: live?.sha ?? null,
      });
    } catch (err) {
      if (err instanceof WritebackConflictError && attempt === 0) continue;
      throw err;
    }
  }

  // Inalcançável: o loop ou retorna, ou lança na 2ª tentativa.
  throw new WritebackConflictError();
}
