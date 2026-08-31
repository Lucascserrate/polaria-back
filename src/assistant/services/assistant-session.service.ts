import { Injectable } from '@nestjs/common';
import { ClientsService } from '../../clients/clients.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { ConversationState } from '../../conversations/entities/conversation.entity';
import type { Client } from '../../clients/entities/client.entity';
import type { Conversation } from '../../conversations/entities/conversation.entity';
import { buildTempName } from '../utils/assistant-utils';

@Injectable()
export class AssistantSessionService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * El cliente detrás de un mensaje de WhatsApp.
   *
   * Reconocerlo o darlo de alta es trabajo del resolver de `clients`, que es el
   * mismo que usan la página pública y el panel: así la persona que ya reservó
   * por la web es la misma que escribe por acá. El `phone` es el `wa_id` de
   * Meta, que ya viene en el formato de referencia, y se declara como tal para
   * que no se le aplique el prefijo del país del negocio —hacerlo rompe a
   * cualquier cliente que no sea de ese país—.
   *
   * Lo que queda acá es lo único propio de WhatsApp: el nombre provisorio.
   */
  async getOrCreateClient(params: {
    tenantId: string;
    phone: string;
    clientName?: string;
  }): Promise<Client> {
    const { tenantId, phone, clientName } = params;
    const trimmedIncomingName = clientName?.trim();

    const client = await this.clientsService.resolveByPhone({
      tenantId,
      phone: { kind: 'whatsapp', value: phone },
      /*
       * Sin nombre de perfil se guarda uno provisorio en vez de dejarlo vacío:
       * el negocio ve la cita en la agenda antes de saber cómo se llama quien la
       * reservó, y "Usuario 3456" al menos la distingue de las demás.
       */
      name: trimmedIncomingName || buildTempName(phone),
    });

    /*
     * El provisorio cede ante el nombre real. Sólo el provisorio: si el negocio
     * ya lo cargó a mano —con apellido, o con una nota para reconocerlo—, ese
     * gana sobre el del perfil de WhatsApp, que la persona cambia cuando quiere.
     */
    if (trimmedIncomingName) {
      const existingName = (client.name ?? '').trim();
      const looksTemporary = existingName.startsWith('Usuario ');
      if (looksTemporary && existingName !== trimmedIncomingName) {
        const updated = await this.clientsService.update(client.id, {
          name: trimmedIncomingName,
        });
        if (updated) return updated;
      }
    }

    return client;
  }

  async getOrCreateConversation(params: {
    tenantId: string;
    clientId: string;
  }): Promise<Conversation> {
    const { tenantId, clientId } = params;

    let conversation = await this.conversationsService.findByTenantAndClient(
      tenantId,
      clientId,
    );
    if (conversation) return conversation;

    conversation = await this.conversationsService.create({
      tenantId,
      clientId,
      currentState: ConversationState.IDLE,
      contextJson: {},
    });
    return conversation;
  }

  async getOrCreateSession(params: {
    tenantId: string;
    phone: string;
    clientName?: string;
  }): Promise<{ client: Client; conversation: Conversation }> {
    const client = await this.getOrCreateClient(params);
    const conversation = await this.getOrCreateConversation({
      tenantId: params.tenantId,
      clientId: client.id,
    });
    return { client, conversation };
  }
}
