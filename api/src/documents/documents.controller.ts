import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  findAll() {
    return this.documents.findAll();
  }

  /**
   * Accepts either a multipart file upload (field "file") or a JSON body
   * { name, content }. Text is read as UTF-8 (demo scope: text documents).
   */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { name?: string; content?: string },
  ) {
    if (file) {
      return this.documents.create(file.originalname, file.buffer.toString('utf-8'));
    }
    if (body?.content) {
      return this.documents.create(body.name ?? 'Untitled.txt', body.content);
    }
    throw new BadRequestException('Provide a file upload or { name, content }.');
  }

  /** Re-chunk a stored document after a chunker change; re-embeds only changed text. */
  @Post(':id/reindex')
  reindex(@Param('id') id: string) {
    return this.documents.reindex(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }
}
