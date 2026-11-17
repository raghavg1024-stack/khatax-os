/** Sarvam Saaras v4 realtime codes; Gnani coverage follows its published STT list. */
export const LANGUAGES = [
  { code: "hi-IN", name: "Hindi", native: "हिन्दी", gnani: true },
  { code: "en-IN", name: "English", native: "English", gnani: true },
  { code: "as-IN", name: "Assamese", native: "অসমীয়া", gnani: false },
  { code: "bn-IN", name: "Bengali", native: "বাংলা", gnani: true },
  { code: "brx-IN", name: "Bodo", native: "बड़ो", gnani: false },
  { code: "doi-IN", name: "Dogri", native: "डोगरी", gnani: false },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી", gnani: true },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ", gnani: true },
  { code: "ks-IN", name: "Kashmiri", native: "کٲشُر", gnani: false },
  { code: "kok-IN", name: "Konkani", native: "कोंकणी", gnani: false },
  { code: "mai-IN", name: "Maithili", native: "मैथिली", gnani: false },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം", gnani: true },
  { code: "mni-IN", name: "Manipuri", native: "ꯃꯤꯇꯩ ꯂꯣꯟ", gnani: false },
  { code: "mr-IN", name: "Marathi", native: "मराठी", gnani: true },
  { code: "ne-IN", name: "Nepali", native: "नेपाली", gnani: false },
  { code: "or-IN", name: "Odia", native: "ଓଡ଼ିଆ", gnani: false },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ", gnani: true },
  { code: "sa-IN", name: "Sanskrit", native: "संस्कृतम्", gnani: false },
  { code: "sat-IN", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", gnani: false },
  { code: "sd-IN", name: "Sindhi", native: "سنڌي", gnani: false },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்", gnani: true },
  { code: "te-IN", name: "Telugu", native: "తెలుగు", gnani: true },
  { code: "ur-IN", name: "Urdu", native: "اردو", gnani: false },
] as const;

export const AUTO_LANGUAGE = {
  code: "auto", name: "Auto-detect", native: "Any supported language", gnani: false,
} as const;
