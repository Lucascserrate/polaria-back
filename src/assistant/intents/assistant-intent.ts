export enum AssistantIntent {
  GREETING = 'GREETING',
  ASK_SERVICES = 'ASK_SERVICES',
  ASK_HOURS = 'ASK_HOURS',
  BOOKING = 'BOOKING',
  SHOW_HOURS = 'SHOW_HOURS',
  SUMMARY = 'SUMMARY',
  CONFIRM_BOOKING = 'CONFIRM_BOOKING',
  OFF_TOPIC = 'OFF_TOPIC',
}

export type AssistantIntentEntities = {
  services?: string[] | null;
  staff?: string | null;
  date?: string | null;
  time?: string | null;
};

export interface AssistantIntentRouterResult {
  intent: AssistantIntent;
  entities: AssistantIntentEntities;
}
