export type WhatsappInteractiveReplyButton = {
  id: string;
  title: string;
};

export type WhatsappInteractiveButtonMessage = {
  kind: 'buttons';
  text: string;
  buttons: WhatsappInteractiveReplyButton[];
};

export type WhatsappInteractiveListMessage = {
  kind: 'list';
  text: string;
  buttonText: string;
  sections: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
};

export type WhatsappInteractiveFlowMessage = {
  kind: 'flow';
  text: string;
  flowToken: string;
  flowId: string;
  flowCta: string;
  flowAction?: 'navigate' | 'data_exchange';
};

export type WhatsappInteractiveMessage =
  | WhatsappInteractiveButtonMessage
  | WhatsappInteractiveListMessage
  | WhatsappInteractiveFlowMessage;
