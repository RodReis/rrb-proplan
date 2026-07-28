import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SettingsModule } from '../settings/settings.module';
import { LlmUsageRecorder } from './application/llm-usage.recorder';
import { UsageService } from './application/usage.service';
import { AnthropicClient } from './infrastructure/anthropic.client';
import { LlmClientFactory } from './infrastructure/llm-client.factory';
import { UsageController } from './presentation/usage.controller';

/**
 * Acesso a LLM: a porta, os adapters, o ledger e o gate do teto.
 *
 * Extraído do `insight` em 2026-07-27 (SPEC-032 §7.2, pré-requisito 2). Antes
 * disso, quem quisesse chamar um modelo importava `insight/domain/llm-client` —
 * o que para o módulo `artifacts` (Fatia 21) seria **violação direta e
 * greppável do ADR-001**: módulos se comunicam por interfaces públicas
 * exportadas, nunca importando entidade interna de outro módulo.
 *
 * O `insight` passou a ser **cliente** deste módulo como qualquer outro, e
 * continua dono do que é dele: prompts, `input-hash`, orçamento de contexto.
 *
 * A interface pública são os três `exports` abaixo. `LlmClientFactory` resolve
 * o adapter do provedor ativo (ADR-008), `LlmUsageRecorder` grava o ledger
 * append-only (ADR-016) e `UsageService` é o gate do teto — que o §2.6 da
 * SPEC-032 manda verificar **antes** de enfileirar e antes de cada capacidade.
 */
@Module({
  imports: [SettingsModule, IdentityModule],
  controllers: [UsageController],
  providers: [LlmUsageRecorder, UsageService, LlmClientFactory, AnthropicClient],
  exports: [LlmUsageRecorder, UsageService, LlmClientFactory],
})
export class LlmModule {}
