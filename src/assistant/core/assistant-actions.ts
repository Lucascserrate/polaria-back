export enum AssistantAction {
  ASK_SERVICE = 'ASK_SERVICE',
  ASK_DATE = 'ASK_DATE',
  ASK_TIME = 'ASK_TIME',
  ASK_STAFF = 'ASK_STAFF',
  SHOW_HOURS = 'SHOW_HOURS',
  RESUMEN = 'RESUMEN',
  CONFIRM_BOOKING = 'CONFIRM_BOOKING',
}

export const isAssistantAction = (value: unknown): value is AssistantAction => {
  return (
    typeof value === 'string' &&
    (Object.values(AssistantAction) as string[]).includes(value)
  );
};
