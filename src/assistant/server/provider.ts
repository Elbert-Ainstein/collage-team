// Which company answers the assistant, from the environment.
//
// Gemini when its key is set, Anthropic otherwise — the Anthropic key was a
// stand-in while the course's Gemini key was on its way. ASSISTANT_PROVIDER
// picks one explicitly and ASSISTANT_MODEL names the model; both are optional.
//
// The defaults are the cheapest models that passed every case in the
// assistant's evaluation (made-up classes: targeted moves, an ambiguous name,
// messy lists, and an 80-student team-forming request with five rules).

export const DEFAULT_MODELS = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-sonnet-5-5",
} as const;

export type Provider = keyof typeof DEFAULT_MODELS;

export interface ProviderChoice {
  provider: Provider;
  model: string;
  apiKey: string;
}

const KEYS: Record<Provider, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" };

export function chooseProvider(env: Record<string, string | undefined>): ProviderChoice | null {
  const key = (p: Provider) => env[KEYS[p]]?.trim() || null;
  const asked = env.ASSISTANT_PROVIDER?.trim().toLowerCase();
  const provider: Provider | null =
    asked === "gemini" || asked === "anthropic" ? asked : key("gemini") ? "gemini" : key("anthropic") ? "anthropic" : null;
  const apiKey = provider ? key(provider) : null;
  if (!provider || !apiKey) return null;
  return { provider, model: env.ASSISTANT_MODEL?.trim() || DEFAULT_MODELS[provider], apiKey };
}
