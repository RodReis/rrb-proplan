import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  BriefingAttachmentService,
  type AttachmentDto,
} from '../application/briefing-attachment.service';
import { MAX_FILE_BYTES } from '../domain/file-signature';
import { SlidingWindowRateLimiter } from '../../../shared/rate-limiter';

/**
 * Forma do arquivo que o Multer entrega.
 *
 * Declarada aqui em vez de instalar `@types/multer`: o pacote de tipos traria
 * um namespace global inteiro para descrever três campos que este controller
 * usa. `multer` já vem como dependência transitiva do `@nestjs/platform-express`
 * — o que falta é só a tipagem, e ela cabe em cinco linhas.
 */
interface UploadedMulterFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * Anexos do briefing PÚBLICO (SPEC-031 §4) — sem sessão, como o irmão
 * `BriefingPublicController`.
 *
 * Controller separado por um motivo prático: o `FileInterceptor` precisa da
 * configuração de limites do Multer, e pendurá-la no controller do formulário
 * misturaria o teto de upload com as rotas de texto, que não têm nada a ver com
 * isso.
 *
 * **Rate limit mais apertado que o do rascunho** (5/min contra 10/min): o
 * briefing aceita no máximo 5 arquivos no total, então uso legítimo acima disso
 * não existe — e cada requisição aqui carrega até 10 MB, o que torna esta a
 * rota mais cara de abusar do produto inteiro.
 */
const UPLOAD_RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const PRUNE_INTERVAL_MS = 5 * 60_000;

@Controller('b')
export class BriefingAttachmentController {
  private readonly limiter = new SlidingWindowRateLimiter(
    UPLOAD_RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  private readonly pruneTimer: NodeJS.Timeout;

  constructor(private readonly attachments: BriefingAttachmentService) {
    this.pruneTimer = setInterval(() => this.limiter.prune(), PRUNE_INTERVAL_MS);
    // Timer ativo seguraria o processo vivo no shutdown e travaria os testes.
    this.pruneTimer.unref();
  }

  /** Anexos já enviados neste rascunho — metadado, nunca bytes. */
  @Get(':token/attachments')
  list(@Param('token') token: string, @Req() req: Request): Promise<AttachmentDto[]> {
    this.enforce(token, req);
    return this.attachments.list(token);
  }

  /**
   * Recebe UM arquivo por requisição.
   *
   * O `limits` do Multer é a primeira barreira e a mais barata: um upload de
   * 500 MB é cortado no stream, sem nunca virar Buffer. A verificação de
   * assinatura de bytes vem depois, no domain — esta aqui só evita gastar
   * memória com o que já está obviamente fora do teto.
   */
  @Post(':token/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    }),
  )
  async upload(
    @Param('token') token: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Req() req: Request,
  ): Promise<AttachmentDto> {
    this.enforce(token, req);

    if (!file?.buffer) {
      throw new UnprocessableEntityException({
        message: 'nenhum arquivo enviado',
        reason: 'empty_file',
      });
    }

    return this.attachments.attach(token, file);
  }

  /** Remove um anexo do rascunho, antes do submit. */
  @Delete(':token/attachments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('token') token: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    this.enforce(token, req);
    await this.attachments.remove(token, id);
  }

  /** Chave IP+token, igual à do formulário: limita varredura sem punir quem responde. */
  private enforce(token: string, req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'desconhecido';
    const decision = this.limiter.check(`${ip}:${token}`);

    if (!decision.allowed) {
      throw new HttpException(
        { status: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
        { description: `retry-after ${decision.retryAfterSeconds}s` },
      );
    }
  }
}
