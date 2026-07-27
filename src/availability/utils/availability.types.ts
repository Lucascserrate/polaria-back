export type FindAvailableSlotsInput = {
  tenantId: string;
  serviceIds: string[];
  desiredDate: string; // YYYY-MM-DD
  desiredTime: string; // HH:mm
  staffId?: string;
};

export type BookingRejectionReason =
  | 'INVALID_TENANT'
  | 'INVALID_INPUT_DATA'
  | 'PAST_DATE'
  | 'PAST_TIME'
  | 'STAFF_NOT_FOUND'
  | 'SERVICES_NOT_FOUND'
  | 'STAFF_CANNOT_PERFORM_SERVICE'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'STARTS_BEFORE_OPENING_HOURS'
  | 'ENDS_AFTER_CLOSING_HOURS'
  | 'REQUESTED_DURATION_EXCEEDS_WORKING_TIME'
  | 'NO_AVAILABLE_SLOT'
  | 'STAFF_ALREADY_BUSY'
  | 'OVERLAPS_ACTIVE_APPOINTMENT'
  | 'SLOT_NO_LONGER_AVAILABLE'
  | 'UNKNOWN_BUSINESS_RULE';

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
  rejectionReason?: BookingRejectionReason;
  rejectionMessage?: string;
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
