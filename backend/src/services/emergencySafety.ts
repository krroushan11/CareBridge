export const EMERGENCY_SEVERITIES = ["NONE", "URGENT", "EMERGENCY"] as const;
export type EmergencySeverity = (typeof EMERGENCY_SEVERITIES)[number];

export interface EmergencyAssessment {
  severity: EmergencySeverity;
  category?: string;
  response?: string;
}

interface EmergencyRule {
  category: string;
  severity: Exclude<EmergencySeverity, "NONE">;
  pattern: RegExp;
  response: string;
}

const emergencyRules: EmergencyRule[] = [
  {
    category: "urgent-care",
    severity: "URGENT",
    pattern: /\b(?:need|needs|seek|seeking)\s+(?:urgent|same[-\s]day)\s+(?:medical|clinical|care)\b|\b(?:urgent|same[-\s]day)\s+(?:medical|clinical)\s+(?:help|attention)\b/i,
    response: "Please seek urgent medical care today. If symptoms become severe or life-threatening, contact your local emergency service or go to the nearest emergency department.",
  },
  {
    category: "breathing",
    severity: "EMERGENCY",
    pattern: /\b(?:can't|cannot|unable to|not able to|struggling to|difficulty(?: with)?|trouble)\s+(?:breathe|breathing)\b|\bsevere breathing difficulty\b|\bturning blue\b/i,
    response: "This may be a breathing emergency. Contact your local emergency service now or go to the nearest emergency department. Do not drive yourself if you are severely unwell.",
  },
  {
    category: "chest",
    severity: "EMERGENCY",
    pattern: /\b(?:severe\s+)?chest\s+(?:pain|pressure|tightness|heaviness)\b|\b(?:pain|pressure|tightness)\s+(?:in|across|around)\s+(?:my|the)\s+chest\b/i,
    response: "This may be a chest emergency. Contact your local emergency service now or go to the nearest emergency department. Do not drive yourself if you are severely unwell.",
  },
  {
    category: "stroke",
    severity: "EMERGENCY",
    pattern: /\b(?:face droop|facial droop|slurred speech|speech is slurred|can't speak|cannot speak|one[-\s]sided weakness|arm weakness|sudden weakness|sudden confusion|stroke symptoms?)\b/i,
    response: "These may be stroke warning signs. Contact your local emergency service immediately and note when the symptoms started. Do not drive yourself.",
  },
  {
    category: "bleeding",
    severity: "EMERGENCY",
    pattern: /\b(?:uncontrolled|can't stop|cannot stop|won't stop|heavy|severe)\s+(?:bleeding|blood loss)\b|\bbleeding\s+(?:profusely|heavily|won't stop)\b/i,
    response: "This may be a severe bleeding emergency. Contact your local emergency service now. Apply firm direct pressure with clean material if possible and do not delay emergency care.",
  },
  {
    category: "seizure-or-unresponsive",
    severity: "EMERGENCY",
    pattern: /\b(?:having|had|a)\s+seizure\b|\b(?:unresponsive|unconscious|passed out|not waking|won't wake)\b/i,
    response: "This may be an emergency. Contact your local emergency service now. Keep the person safe from injury, do not restrain them, and do not put anything in their mouth.",
  },
  {
    category: "anaphylaxis",
    severity: "EMERGENCY",
    pattern: /\b(?:anaphylaxis|anaphylactic|severe allergic reaction|throat is closing|throat closing|swelling of (?:the )?(?:face|lips|tongue|throat))\b/i,
    response: "This may be a severe allergic reaction. Contact your local emergency service now. If a prescribed emergency injector is available, use it as directed while waiting for help.",
  },
  {
    category: "self-harm",
    severity: "EMERGENCY",
    pattern: /\b(?:want to|going to|plan to|planning to|might)\s+(?:kill|harm|hurt)\s+(?:myself|me)\b|\b(?:suicidal|suicide|suicide attempt|overdose myself)\b/i,
    response: "You may be in immediate danger. Contact your local emergency service or go to the nearest emergency department now. If possible, stay with someone you trust and move away from anything you could use to hurt yourself.",
  },
  {
    category: "overdose",
    severity: "EMERGENCY",
    pattern: /\b(?:overdose|taken too much|swallowed too many|poisoned|poisoning)\b/i,
    response: "This may be a poisoning or overdose emergency. Contact your local emergency service now or go to the nearest emergency department. Do not wait for symptoms to worsen.",
  },
];

export const assessEmergency = (message: string): EmergencyAssessment => {
  const rule = emergencyRules.find((candidate) => candidate.pattern.test(message));
  return rule
    ? { severity: rule.severity, category: rule.category, response: rule.response }
    : { severity: "NONE" };
};
