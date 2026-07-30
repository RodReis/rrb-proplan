/**
 * Inadimplência de assinatura: quando o atraso vira corte de acesso.
 *
 * Regra pura, sem banco e sem relógio implícito — `now` entra por parâmetro
 * (mesmo motivo do formatador da #76: teste que depende do relógio da máquina
 * passa por coincidência e quebra no CI).
 *
 * ## Por que a comparação vive aqui, e não num job
 *
 * A spec é explícita: *"a comparação mora na validação, como a de `expiresAt` —
 * nunca em job"*. Um job que virasse o status seria uma **segunda fonte** do
 * fato "esta licença vale": entre a hora do corte e a próxima execução, o
 * `/activate` responderia com a resposta velha. Avaliar na validação torna o
 * corte exato por construção — não há janela em que o banco diga uma coisa e a
 * rota outra.
 *
 * ## `null` em cada lado quer dizer coisas diferentes
 *
 * - `pastDueAt = null` → **não há atraso**. A plataforma não avisou nada, ou o
 *   pagamento voltou e o PR-3 limpou o campo. Nunca corta.
 * - `toleranceDays = null` → **o ProPlan não corta por atraso** (decisão PI #3):
 *   quem revoga é sempre a plataforma. Não é "tolerância zero" — é o oposto,
 *   tolerância infinita. Confundir os dois inverteria a decisão do PI, então há
 *   teste para cada um.
 */

/** Dia em milissegundos. Nomeado para o cálculo não virar `86400000` solto. */
const DIA_MS = 24 * 60 * 60 * 1000;

export interface PastDueInput {
  /** Quando a plataforma avisou o atraso. `null` = está em dia. */
  pastDueAt: Date | null;
  /**
   * `LicSettings.pastDueToleranceDays` do tenant, via
   * `resolve_past_due_tolerance`. `null` = nunca cortar.
   */
  toleranceDays: number | null;
  now: Date;
}

/**
 * `true` quando o atraso já passou da tolerância e o acesso deve ser cortado
 * (`410` na validação).
 *
 * Fronteira **exclusiva**: no instante exato em que a tolerância vence o acesso
 * ainda vale, e só depois cai. Espelha o `<=` de `expirou()` invertido pelo
 * lado em que a data está — e escolher o lado importa, porque no dia do
 * vencimento o cliente que paga precisa poder abrir o app.
 */
export function cortarPorInadimplencia({
  pastDueAt,
  toleranceDays,
  now,
}: PastDueInput): boolean {
  // Sem atraso registrado não há o que cortar — o caso comum, primeiro.
  if (!pastDueAt) return false;

  // Decisão PI #3: sem tolerância configurada, o ProPlan nunca corta.
  if (toleranceDays === null) return false;

  // Valor inválido no banco (negativo) é tratado como "não configurado" em vez
  // de cortar na hora: um `-1` digitado no admin não deve derrubar toda a base
  // de clientes de um tenant. Zero é legítimo — significa cortar no dia.
  if (!Number.isFinite(toleranceDays) || toleranceDays < 0) return false;

  return pastDueAt.getTime() + toleranceDays * DIA_MS < now.getTime();
}
