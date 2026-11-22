export type CustomerDraft = {step:"name"|"phone"|"nicknames"|"review";name:string;phone:string;nicknames:string};
const tidy = (s:string)=>s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu,"");
export const decision = (s:string) => {
  const value=tidy(s);
  // Speech recognition often returns a full spoken sentence, not the exact
  // one-word answer shown in the prompt. Check negation first so phrases like
  // "don't save" can never be treated as approval.
  if(["cancel","discard","no","dont","donot","नहीं","नही","मत","रद्द","रद्दकरो","ಬೇಡ","ವద్దు","వద్దు","வேண்டாம்","না","করবেননা","નહીં","ਨਹੀਂ","വേണ്ട"].some(word=>value===tidy(word)||value.startsWith(tidy(word))))return "cancel";
  if(["yes","yeah","yep","haan","hanji","confirm","confirmed","save","saveit","create","createit","addit","goahead","ठीकहै","सहीहै","हां","हाँ","जीहाँ","बनादो","बनादें","बनाइए","जोड़दो","जोड़दें","जोड़िए","सहेजो","ಹೌದು","ಸರಿ","ಮಾಡಿ","అవును","సరే","చేయండి","ஆம்","சரி","செய்யுங்கள்","ঠিকআছে","করুন","બરાબર","બનાવો","ਠੀਕ","ਕਰੋ","ശരി","ചെയ്യൂ"].some(word=>value===tidy(word)||value.startsWith(tidy(word))))return "confirm";
  return "other";
};
export function beginsCustomerConversation(text:string) {
  return /\b(?:add|create|new)\s+(?:a\s+)?(?:new\s+)?customer\b|(?:नया|नए|नये)\s*(?:ग्राहक|कस्टमर)|(?:ग्राहक|कस्टमर).*?(?:जोड़|जोड़|बना)|ಹೊಸ\s*ಗ್ರಾಹಕ|కొత్త\s*(?:కస్టమర్|వినియోగదారు)|புதிய\s*வாடிக்கையாளர்|নতুন\s*গ্রাহক|નવો\s*ગ્રાહક|नवीन\s*ग्राहक|ਨਵਾਂ\s*ਗਾਹਕ|പുതിയ\s*ഉപഭോക്താ/i.test(text);
}
export function draftQuestion(draft:CustomerDraft) {
  return draft.step === "name" ? "What is the new customer's full name?"
    : draft.step === "phone" ? `What is ${draft.name}'s mobile number? Say skip if you do not have it.`
    : draft.step === "nicknames" ? "Do they have a nickname? Say the nickname, or say skip."
    : `Create customer ${draft.name}, mobile ${draft.phone || "not provided"}, nickname ${draft.nicknames || "not provided"}? Say confirm to save, or cancel.`;
}
export function advanceCustomer(draft:CustomerDraft,text:string) {
  if (decision(text) === "cancel" && (draft.step === "review" || !["नहीं","नही","ಬೇಡ","వద్దు"].includes(tidy(text)))) return {kind:"cancel"} as const;
  if (draft.step === "review") return {kind:decision(text) === "confirm" ? "save" : "repeat",draft} as const;
  const skip=["skip","none","नहीं","छोड़ो","छोडो","नही","ಬೇಡ","వద్దు"].includes(tidy(text));
  if (draft.step === "name") {
    const name=text.trim().replace(/^(?:(?:his|her|their|the customer's|my)\s+)?name is\s+|^(?:(?:उसका|उनका|मेरा|ग्राहक का)\s+)?नाम\s+/iu,"").replace(/\s+(?:है|हैं)[।.!]?$/u,"").trim();
    if (name.length<2 || name.length>80) return {kind:"error",message:"Please give a name between 2 and 80 characters."} as const;
    return {kind:"next",draft:{...draft,name,step:"phone"}} as const;
  }
  if (draft.step === "phone") {
    let phone=text.replace(/[०-९]/g,c=>String(c.charCodeAt(0)-2406)).replace(/[^\d+]/g,"");
    if (skip) phone="";
    if (phone && !/^(?:\+?91)?[6-9]\d{9}$/.test(phone)) return {kind:"error",message:"Please say a valid 10 digit Indian mobile number, or say skip."} as const;
    if (/^91\d{10}$/.test(phone)) phone="+"+phone;
    return {kind:"next",draft:{...draft,phone,step:"nicknames"}} as const;
  }
  if (text.length>200) return {kind:"error",message:"Please give a shorter nickname, or say skip."} as const;
  return {kind:"next",draft:{...draft,nicknames:skip ? "" : text.trim(),step:"review"}} as const;
}
