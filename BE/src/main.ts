import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { configureApp } from './configure-app.js';
import { NestExpressApplication } from '@nestjs/platform-express';
import path from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.useStaticAssets(
    path.resolve(
      process.env.UPLOAD_ROOT ?? path.resolve(process.cwd(), '../uploads'),
    ),
    { prefix: '/uploads/' },
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BCKL E-commerce API')
    .setDescription('API cho hệ thống thương mại điện tử đa vai trò')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.BACKEND_PORT || 3001;
  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
