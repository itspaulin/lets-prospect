import { DomainError } from '../../core/errors.js';

export type BedrockOptions = { token: string; region: string; modelId: string; fetch?: typeof fetch; baseUrl?: string };

export type ToolSpec = { name: string; description: string; inputSchema: { json: unknown } };

// Bedrock API key (bearer token) plus the Converse API: no AWS SDK and no IAM profile in this project.
// The model is forced to answer through one tool, so the reply is structured data instead of prose.
export const converseWithTool = async (options: BedrockOptions, request: { system: string; user: string; tool: ToolSpec; maxTokens: number }): Promise<unknown> => {
  const base = options.baseUrl ?? `https://bedrock-runtime.${options.region}.amazonaws.com`;
  const response = await (options.fetch ?? fetch)(`${base}/model/${encodeURIComponent(options.modelId)}/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
    body: JSON.stringify({
      system: [{ text: request.system }],
      messages: [{ role: 'user', content: [{ text: request.user }] }],
      inferenceConfig: { maxTokens: request.maxTokens },
      toolConfig: { tools: [{ toolSpec: request.tool }], toolChoice: { tool: { name: request.tool.name } } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new DomainError('provider_error', `Bedrock respondeu ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
  const body = (await response.json()) as { output?: { message?: { content?: { toolUse?: { input: unknown } }[] } } };
  return body.output?.message?.content?.find((block) => block.toolUse)?.toolUse?.input;
};
