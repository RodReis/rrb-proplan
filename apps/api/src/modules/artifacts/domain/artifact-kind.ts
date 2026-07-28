import { ArtifactKind as PrismaArtifactKind } from '@prisma/client';

/** Os 4 tipos de artefato da fatia (SPEC-032 §2.3). */
export type ArtifactKind = PrismaArtifactKind;

/**
 * As capacidades **na ordem em que rodam** (§2.3):
 * `normalize` → `scope` → `requirements` → `site_prompt`.
 *
 * A ordem é contrato, não preferência: cada uma consome a saída das anteriores
 * (o `scope` lê o `normalize`, o `requirements` lê o `scope`). Declarada aqui
 * como array em vez de derivada de `Object.values(PrismaArtifactKind)` porque a
 * ordem de um enum do Prisma é a ordem de declaração no schema — uma
 * reordenação lá, feita por qualquer motivo estético, mudaria a ordem de
 * execução do pipeline em silêncio.
 */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'normalize',
  'scope',
  'requirements',
  'site_prompt',
] as const;

/** Quantos artefatos precisam estar aprovados para o card mover (§2.7). */
export const REQUIRED_ARTIFACT_COUNT = ARTIFACT_KINDS.length;
