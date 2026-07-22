import { Controller, Get } from '@nestjs/common';

/**
 * Healthcheck do Railway (SPEC-027).
 *
 * Responde 200 enquanto o processo está de pé — e só isso. Não toca Postgres
 * nem Redis de propósito: o healthcheck decide se a versão nova assume o
 * tráfego, e uma falha transitória de fila derrubaria um deploy que de outro
 * modo está são. Indisponibilidade de dependência é problema de observabilidade
 * (fatia própria), não de liveness.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}
