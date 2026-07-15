// Must come first: config is read while the modules below are being constructed.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Allow the Next.js frontend (localhost:3005) to call the API.
  app.enableCors({ origin: true });
  const port = process.env.PORT ? Number(process.env.PORT) : 3006;
  await app.listen(port);
  console.log(`DemoAI API listening on http://localhost:${port}`);
}
bootstrap();
