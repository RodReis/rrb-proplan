import { useEffect, useRef, useState } from 'react';
import {
  LinkGoneError,
  MAX_FILES,
  MAX_FILE_BYTES,
  UploadRejectedError,
  UnreachableError,
  listAttachments,
  removeAttachment,
  uploadAttachment,
  type Attachment,
} from './briefingApi';

/**
 * Anexos da Etapa 5 (SPEC-031 §4).
 *
 * Componente com rede própria, ao contrário do `StepField`: o anexo não vive no
 * `jsonb` do rascunho, vive na própria tabela e sobe no momento em que é
 * escolhido. Enfiar isto no `StepField` (que é burro de propósito) obrigaria o
 * `BriefingForm` a carregar estado de upload que nenhuma outra etapa usa.
 *
 * A regra que a tela cumpre: **os limites daqui são conveniência, a barreira é
 * a API**. A checagem local de tamanho evita gastar 40 MB de upload para ouvir
 * "não"; quem recusa de verdade é o servidor, que verifica a assinatura dos
 * bytes — e a mensagem dele é a que aparece.
 */

interface Props {
  token: string;
  /** Link morreu no meio (revogado/expirado/enviado). */
  onLinkGone: () => void;
}

/** Aceite do seletor de arquivo — espelha a allowlist do ADR-025. */
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

export function Attachments({ token, onLinkGone }: Props) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    listAttachments(token, controller.signal)
      .then(setFiles)
      .catch(() => {
        // Falha ao LISTAR não é erro de tela: quem abriu a etapa ainda não fez
        // nada. A lista fica vazia e o upload continua disponível.
      });
    return () => controller.abort();
  }, [token]);

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const isFull = files.length >= MAX_FILES;

  const handlePick = async (picked: File | undefined) => {
    // O input é limpo sempre: sem isto, escolher o MESMO arquivo depois de um
    // erro não dispararia `change` de novo, e a tela ficaria travada no erro.
    if (inputRef.current) inputRef.current.value = '';
    if (!picked) return;

    setError(null);

    // Conveniência: evita subir 40 MB para ouvir 413. O servidor decide o resto.
    if (picked.size > MAX_FILE_BYTES) {
      setError('arquivo acima de 10 MB');
      return;
    }

    setBusy(true);
    try {
      const saved = await uploadAttachment(token, picked);
      setFiles((prev) => [...prev, saved]);
    } catch (err) {
      if (err instanceof LinkGoneError) {
        onLinkGone();
        return;
      }
      // A mensagem do servidor vence: é ela que conhece o motivo real (tipo
      // fora da allowlist, cota do briefing, assinatura que não bate).
      if (err instanceof UploadRejectedError) setError(err.message);
      else if (err instanceof UnreachableError) setError('sem conexão — tente de novo');
      else setError('não foi possível enviar o arquivo');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setError(null);
    // Otimista com rollback: o arquivo some na hora e volta se o servidor
    // recusar. Esperar o round-trip para sumir um item que a pessoa acabou de
    // mandar apagar faria a tela parecer travada.
    const snapshot = files;
    setFiles((prev) => prev.filter((f) => f.id !== id));

    try {
      await removeAttachment(token, id);
    } catch (err) {
      if (err instanceof LinkGoneError) {
        onLinkGone();
        return;
      }
      setFiles(snapshot);
      setError('não foi possível remover o arquivo');
    }
  };

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="field-attachments"
        className="block text-sm font-medium text-text2"
      >
        Logo, referências e documentos
      </label>
      <p id="field-attachments-hint" className="text-xs leading-relaxed text-faint">
        PNG, JPEG, WebP ou PDF. Até 10 MB por arquivo, {MAX_FILES} arquivos no
        total.
      </p>

      {files.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border2 bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-body2" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {formatSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => void handleRemove(file.id)}
                className="shrink-0 text-xs font-medium text-body2 underline underline-offset-2 hover:text-error"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 pt-1">
        <input
          ref={inputRef}
          id="field-attachments"
          type="file"
          accept={ACCEPT}
          aria-describedby="field-attachments-hint"
          disabled={busy || isFull}
          onChange={(e) => void handlePick(e.target.files?.[0])}
          className="block w-full text-xs text-body2 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border2 file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-text2 hover:file:bg-surface-hover disabled:opacity-40"
        />
      </div>

      {busy && (
        <p role="status" className="text-[11px] text-faint">
          Enviando…
        </p>
      )}

      {isFull && !busy && (
        <p className="text-[11px] text-faint">
          Limite de {MAX_FILES} arquivos atingido ({formatSize(totalBytes)} no
          total).
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
