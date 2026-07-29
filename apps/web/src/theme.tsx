import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'carbono' | 'claro';

/** Carbono é o padrão (DESIGN.md §4). */
const DEFAULT_THEME: Theme = 'carbono';
const STORAGE_KEY = 'proplan:theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(v: unknown): v is Theme {
  return v === 'carbono' || v === 'claro';
}

/**
 * Lê o tema salvo. O login (pré-autenticação) também usa este valor — por isso
 * localStorage e não a API.
 *
 * Dívida registrada na SPEC-020: o design system manda preferência via API; o PI
 * decidiu (2026-07-15) adiar o endpoint até existir uma segunda preferência a
 * guardar. Migrar as duas juntas quando isso acontecer.
 */
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // localStorage indisponível (modo privado//SSR) — o padrão ainda serve.
    return DEFAULT_THEME;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // O <html> carrega o data-theme: as custom properties de tokens.css penduram
  // nele, então a troca re-pinta a UI inteira sem reload e sem re-render.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Sem persistência, o tema ainda vale para esta sessão.
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === 'carbono' ? 'claro' : 'carbono')),
    [],
  );

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme fora de <ThemeProvider>');
  return ctx;
}

/**
 * Lê o valor computado de um token.
 *
 * Escotilha para bibliotecas que recebem cor por *prop* e não por CSS
 * (react-flow: Background/MiniMap) — aí `var(--token)` não resolve. Em
 * qualquer outro lugar use `var(--token)` ou o utilitário Tailwind: só isto
 * precisa re-executar quando o tema troca.
 */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * `readToken` reancorado no tema: devolve um leitor que muda de identidade
 * quando o tema troca, forçando o consumidor a repintar.
 */
export function useToken(): (name: string) => string {
  const { theme } = useTheme();
  // `theme` é a dep real, ainda que a regra a chame de desnecessária: ela olha
  // o corpo do callback e não vê `theme` ali. Mas `readToken` lê o DOM, e o DOM
  // já mudou quando o tema muda — é exatamente isso que precisa reexecutar a
  // leitura. Tirar a dep congelaria o valor do tema anterior.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((name: string) => readToken(name), [theme]);
}
