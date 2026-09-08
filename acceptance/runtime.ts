export type Step = { keyword: string; text: string; parameters?: string[] };
export type Scenario = { name: string; steps: Step[]; examples: Record<string, string>[] };
export type Feature = { name: string; background?: Step[]; scenarios: Scenario[] };
export type World = { baseURL: string; lastTodo?: string };
export type StepHandler = (world: World, text: string) => Promise<void>;
export type StepDefinition = { pattern: RegExp; run: StepHandler };

function expand(text: string, examples: Record<string, string>): string {
  return text.replace(/<([A-Za-z0-9_]+)>/g, (_, name: string) => {
    if (!(name in examples)) throw new Error(`Missing example value: ${name}`);
    return examples[name];
  });
}

export async function runFeature(feature: Feature, definitions: StepDefinition[], baseURL: string) {
  for (const scenario of feature.scenarios) {
    const examples = scenario.examples.length > 0 ? scenario.examples : [{}];
    for (const values of examples) {
      const world: World = { baseURL };
      for (const step of [...(feature.background ?? []), ...scenario.steps]) {
        const text = expand(step.text, values);
        const definition = definitions.find(({ pattern }) => {
          pattern.lastIndex = 0;
          return pattern.test(text);
        });
        if (!definition) throw new Error(`Unsupported step: ${text}`);
        await definition.run(world, text);
      }
    }
  }
}
