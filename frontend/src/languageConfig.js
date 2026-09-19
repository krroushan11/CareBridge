export const CHAT_LANGUAGES = [
  { code: "en", displayName: "English", locale: "en-IN", enabled: true },
  { code: "en-simple", displayName: "Simple English", locale: "en-IN", enabled: true },
  { code: "hi", displayName: "Hindi", locale: "hi-IN", enabled: true },
  { code: "bn", displayName: "Bengali", locale: "bn-IN", enabled: true },
  { code: "mr", displayName: "Marathi", locale: "mr-IN", enabled: true },
  { code: "ta", displayName: "Tamil", locale: "ta-IN", enabled: true },
  { code: "te", displayName: "Telugu", locale: "te-IN", enabled: true },
  { code: "kn", displayName: "Kannada", locale: "kn-IN", enabled: true },
  { code: "gu", displayName: "Gujarati", locale: "gu-IN", enabled: true },
  { code: "pa", displayName: "Punjabi", locale: "pa-IN", enabled: true },
  { code: "ml", displayName: "Malayalam", locale: "ml-IN", enabled: true },
];

export const isChatLanguage = (value) => CHAT_LANGUAGES.some((language) => language.enabled && language.code === value);
