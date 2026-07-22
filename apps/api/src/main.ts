import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5180',
    credentials: true,
  });
  // PORT é injetada pelo Railway; API_PORT é a variável local (SPEC-027).
  // Bind em 0.0.0.0 porque o default do Node no container só escuta loopback —
  // o proxy do Railway não alcançaria o processo.
  const port = Number(process.env.PORT ?? process.env.API_PORT) || 3311;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
