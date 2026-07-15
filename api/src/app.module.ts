import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { QdrantService } from './lib/qdrant.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';

@Module({
  controllers: [DocumentsController, ChatController],
  providers: [PrismaService, QdrantService, DocumentsService, ChatService],
})
export class AppModule {}
