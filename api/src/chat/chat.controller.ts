import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  ask(@Body() body: { message?: string }) {
    const message = body?.message?.trim();
    if (!message) throw new BadRequestException('message is required');
    return this.chat.ask(message);
  }
}
