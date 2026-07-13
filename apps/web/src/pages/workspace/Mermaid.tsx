import { useEffect, useRef, useState } from 'react';

let idSeq = 0;

/** Renderiza um bloco Mermaid. Import lazy (só carrega quando montado). Erro de
 *  sintaxe → mostra o código cru (não derruba a aba). */
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const id = `mmd-${idSeq++}`;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
        const { svg } = await mermaid.render(id, code);
        if (active && ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [code]);

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-md bg-bg p-3 text-xs">
        <code>{code}</code>
      </pre>
    );
  }
  return <div ref={ref} className="my-4 flex justify-center" />;
}
