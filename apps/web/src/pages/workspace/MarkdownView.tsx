import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Mermaid } from './Mermaid';

/** Render de markdown com Mermaid desenhado (vale para todas as abas e Documentos). */
export function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <article className="prose-doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isMermaid = /language-mermaid/.test(className ?? '');
            if (isMermaid) return <Mermaid code={String(children).trim()} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
