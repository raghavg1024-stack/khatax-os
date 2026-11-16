/** Server-only lookups, including the Production names selected during setup. */
export function openAIKey() {
  return process.env.OPENAI_API_KEY || process.env.OPEN_AI;
}
export function gnaniKey() {
  return process.env.GNANI_API_KEY || process.env.GNANI_AI;
}
