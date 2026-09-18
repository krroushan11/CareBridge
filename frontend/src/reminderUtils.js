export const REMINDER_SOUND_PREFERENCE_KEY = "carebridge_reminder_sound_enabled";

export const readReminderSoundPreference = (storage) => storage?.getItem(REMINDER_SOUND_PREFERENCE_KEY) === "true";

export const writeReminderSoundPreference = (storage, enabled) => {
  storage?.setItem(REMINDER_SOUND_PREFERENCE_KEY, String(Boolean(enabled)));
};

export const shouldRequestNotificationPermission = (permission) => permission === "default";

export const findDueDoses = ({ dueDoses = [], upcomingDoses = [], now = Date.now(), snoozedUntilById = new Map() }) => {
  const unique = new Map();
  [...dueDoses, ...upcomingDoses].forEach((dose) => {
    const scheduledAt = new Date(dose.scheduled_at).getTime();
    const snoozedUntil = snoozedUntilById.get(dose.id) || 0;
    if (
      dose?.id &&
      dose.status === "scheduled" &&
      !Number.isNaN(scheduledAt) &&
      scheduledAt <= now &&
      snoozedUntil <= now
    ) unique.set(dose.id, dose);
  });
  return [...unique.values()];
};

export const claimUndeliveredDoses = (doses, deliveredDoseIds) => doses.filter((dose) => {
  if (deliveredDoseIds.has(dose.id)) return false;
  deliveredDoseIds.add(dose.id);
  return true;
});

export const shouldPlayReminderSound = (soundEnabled, audioUnlocked) => soundEnabled && audioUnlocked;

export const shouldPollReminders = (reminderMuted) => !reminderMuted;
