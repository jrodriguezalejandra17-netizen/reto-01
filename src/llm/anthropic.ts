import Anthropic from '@anthropic-ai/sdk';
import { LLMAdapter } from './adapter.js';

export class AnthropicAdapter implements LLMAdapter {
  private client: Anthropic;
  private model: string;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    this.model = process.env.MODEL || 'claude-3-5-sonnet-20240620';
  }

  async enviar(mensajes: any[], herramientas: any[]): Promise<any> {
    const tools = herramientas.map(h => ({
      name: h.name,
      description: h.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(h.args._def.shape()).map(([k, v]: [string, any]) => {
            return [k, { type: v._def.typeName === 'ZodString' ? 'string' : v._def.typeName === 'ZodBoolean' ? 'boolean' : 'array', description: v._def.description || '' }];
          })
        ),
        required: Object.keys(h.args._def.shape())
      }
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: mensajes.filter(m => m.role !== 'system'),
      system: mensajes.find(m => m.role === 'system')?.content || '',
      tools: tools.length > 0 ? tools : undefined
    });

    return response;
  }
}
