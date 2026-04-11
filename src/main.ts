import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors();

  const prefix = configService.get<string>('API_PREFIX') ?? 'api';
  const apiVersion = configService.get<string>('API_VERSION') ?? '1';
  app.setGlobalPrefix(prefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: apiVersion,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BE Livestream API')
    .setDescription('Event Streaming & Ticketing backend API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(configService.get<string>('PORT') ?? 3000);
  await app.listen(port);

  console.log(`Backend running at http://localhost:${port}/${prefix}/v${apiVersion}`);
  console.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
