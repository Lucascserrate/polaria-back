import { Injectable } from '@nestjs/common';

@Injectable()
export class ConversationConfirmationService {
  isConfirm(message: string) {
    const normalized = normalize(message);
    return (
      normalized === 'si' ||
      normalized === 'sí' ||
      normalized.includes('confirmo') ||
      normalized.includes('confirmar') ||
      normalized.includes('ok') ||
      normalized.includes('vale') ||
      normalized.includes('listo')
    );
  }

  isCancel(message: string) {
    const normalized = normalize(message);
    return (
      normalized === 'no' ||
      normalized.includes('cancelar') ||
      normalized.includes('cancela')
    );
  }
}

function normalize(message: string) {
  return message
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
