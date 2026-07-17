import { describe, expect, it } from 'vitest';

import { formatStamp } from './KanbanCard';

/**
 * O formato do carimbo é `dd/MM/aaaa 'às' hh:mm` (decisão do PI, 2026-07-16).
 *
 * O fuso vai por parâmetro, não por `process.env.TZ`: a 1ª versão deste teste
 * setava a env num `beforeAll` e passava — mas por coincidência (minha máquina
 * já é São Paulo). O ICU resolve o fuso quando o processo sobe, então a env
 * depois disso não faz nada, e no CI (UTC) os 3 casos de hora quebravam. Fuso
 * explícito é o único jeito de o teste provar a mesma coisa nas duas máquinas.
 */
const SP = 'America/Sao_Paulo';

describe('formatStamp', () => {
  it('formata ISO do GitHub como dd/MM/aaaa às hh:mm', () => {
    // 2026-07-16T20:52:47Z = 17:52 em São Paulo (UTC-3)
    expect(formatStamp('2026-07-16T20:52:47Z', SP)).toBe('16/07/2026 às 17:52');
  });

  it('usa relógio de 24h — meia-noite é 00:xx, nunca 24:xx', () => {
    expect(formatStamp('2026-07-17T03:05:00Z', SP)).toBe('17/07/2026 às 00:05');
  });

  it('zero-padding em dia, mês e hora de um dígito', () => {
    expect(formatStamp('2026-01-05T12:07:00Z', SP)).toBe('05/01/2026 às 09:07');
  });

  it('formata no fuso pedido — o mesmo instante em UTC', () => {
    expect(formatStamp('2026-07-16T20:52:47Z', 'UTC')).toBe('16/07/2026 às 20:52');
  });

  it('null → null (card sem a data não inventa uma)', () => {
    expect(formatStamp(null)).toBeNull();
  });

  it('ISO inválido → null, nunca "Invalid Date" na tela', () => {
    expect(formatStamp('nao-e-data')).toBeNull();
  });
});
