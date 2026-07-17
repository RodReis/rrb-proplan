import { useEffect, useRef } from 'react';

/**
 * Fecha uma gaveta sozinha depois de `delayMs`, mas só quando ela foi aberta
 * por uma ação automática (o fim do sync), não quando o usuário a abriu de
 * propósito pela pílula — abrir de propósito é dizer "quero ler".
 *
 * O timer só arma na transição de `armed` para `true` (a borda), não a cada
 * render enquanto `armed` segue `true`: senão qualquer re-render (o polling do
 * feed dispara vários) reiniciaria a contagem e a gaveta nunca fecharia.
 *
 * `bumpToken` é o sinal de interação/trabalho: sempre que ele muda com a gaveta
 * armada, a contagem recomeça do zero. O Workspace o incrementa em hover,
 * scroll, clique e enquanto há operação em curso — não fecho na cara de quem lê
 * nem no meio de um job. Parou de mexer por `delayMs` → fecha.
 */
export function useAutoClose(
  armed: boolean,
  bumpToken: number,
  delayMs: number,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => onCloseRef.current(), delayMs);
    return () => clearTimeout(id);
  }, [armed, bumpToken, delayMs]);
}
