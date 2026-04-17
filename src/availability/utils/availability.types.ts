export type FindAvailableSlotsInput = {
  tenantId: string;
  serviceIds: string[];
  desiredDate: string; // YYYY-MM-DD
  desiredTime: string; // HH:mm
  staffId?: string;
};

export type SuggestedSlot = {
  startTime: string; // ISO
  endTime: string; // ISO
  staffId: string;
  staffName: string;
  segments?: Array<{
    serviceId: string;
    staffId: string;
    staffName: string;
    startTime: string; // ISO
    endTime: string; // ISO
  }>;
};

export type AvailabilityResult = {
  isAvailable: boolean;
  suggestedSlots: SuggestedSlot[];
};

export type SlotRange = {
  startTime: Date;
  endTime: Date;
};

export type StaffSlot = SlotRange & {
  staffId: string;
  staffName: string;
  segments?: Array<{
    serviceId: string;
    staffId: string;
    staffName: string;
    startTime: Date;
    endTime: Date;
  }>;
};
