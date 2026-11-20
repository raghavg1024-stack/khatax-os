import type { Preview } from "./shared";

const compact = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
export function replyLanguage(text: string, hint = "en-IN") {
  if (/[\u0900-\u097f]/u.test(text)) return ["hi-IN","mr-IN","ne-IN","sa-IN","mai-IN","doi-IN","kok-IN","brx-IN"].includes(hint) ? hint : "hi-IN";
  if (/[\u0980-\u09ff]/u.test(text) && ["as-IN","mni-IN"].includes(hint)) return hint;
  if (/[\u0600-\u06ff]/u.test(text) && ["ks-IN","sd-IN"].includes(hint)) return hint;
  for (const [pattern, code] of [[/[\u0c80-\u0cff]/u,"kn-IN"],[/[\u0c00-\u0c7f]/u,"te-IN"],[/[\u0b80-\u0bff]/u,"ta-IN"],[/[\u0d00-\u0d7f]/u,"ml-IN"],[/[\u0980-\u09ff]/u,"bn-IN"],[/[\u0a80-\u0aff]/u,"gu-IN"],[/[\u0a00-\u0a7f]/u,"pa-IN"],[/[\u0b00-\u0b7f]/u,"or-IN"],[/[\u0600-\u06ff]/u,"ur-IN"]] as const)
    if (pattern.test(text)) return code;
  return hint;
}

export function conversationFollowup(text: string, preview: Preview) {
  const answer = compact(text);
  if (["cancel","discard","no","नहीं","नही","रद्दकरो","रद्द","ಬೇಡ","వద్దు","வேண்டாம்"].includes(answer)) return {kind:"cancel"} as const;
  if (["yes","confirm","recordit","हाँ","हां","जीहाँ","दर्जकरो","हाँदर्जकरो","ಹೌದು","అవును","ஆம்"].includes(answer))
    return {kind:preview.blocked ? "unresolved" : "confirm"} as const;
  const index = preview.actions.findIndex(a=>a.needsClarification);
  const action = preview.actions[index];
  if (!action) return {kind:"unresolved"} as const;
  if (["createcustomer","addcustomer","नयाग्राहकबनाओ","ग्राहकबनाओ"].includes(answer) && action.customerName && !action.candidates?.length && action.clarificationFields?.includes("customer"))
    return {kind:"create",index} as const;
  if (action.clarificationFields?.includes("customer") && action.candidates?.length) {
    const ordinal = ["one","एक","पहला","ಒಂದು","ఒకటి"].includes(answer) ? 1 : ["two","दो","दूसरा","ಎರಡು","రెండు"].includes(answer) ? 2 : ["three","तीन","तीसरा","ಮೂರು","మూడు"].includes(answer) ? 3 : Number(answer.replace(/[०-९]/g,c=>String(c.charCodeAt(0)-2406)));
    const matches = action.candidates.filter(c=>compact(c.name) === answer);
    const customer = matches.length === 1 ? matches[0] : Number.isInteger(ordinal) && ordinal > 0 ? action.candidates[ordinal-1] : undefined;
    if (customer) return {kind:"clarify",overrides:{[index]:{customerId:customer.id}}} as const;
  }
  if (action.clarificationFields?.includes("amount") && /^\d+(?:\.\d{1,2})?$/.test(text.trim()))
    return {kind:"clarify",overrides:{[index]:{amount:text.trim()}}} as const;
  if (action.clarificationFields?.includes("date") && /^\d{4}-\d{2}-\d{2}$/.test(text.trim()))
    return {kind:"clarify",overrides:{[index]:{date:text.trim()}}} as const;
  return {kind:"unresolved"} as const;
}
