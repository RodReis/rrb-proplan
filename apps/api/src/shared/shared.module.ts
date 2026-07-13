import { Module } from '@nestjs/common';
import { GithubWritebackClient } from './github/github-writeback.client';

/**
 * Infra compartilhada entre módulos. Hoje só o write-back do GitHub Contents
 * (usado por insight e board). Mantém a fronteira DDD: os módulos importam
 * SharedModule em vez de alcançar a infra um do outro.
 */
@Module({
  providers: [GithubWritebackClient],
  exports: [GithubWritebackClient],
})
export class SharedModule {}
