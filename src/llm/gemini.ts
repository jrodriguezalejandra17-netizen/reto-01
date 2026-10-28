import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { LLMAdapter } from './adapter.js';

function zodToGeminiSchema(zodSchema: any): any {
  const shape = zodSchema._def.shape();
  const properties: any = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const v: any = value;
    required.push(key);
    
    if (v._def.typeName === 'ZodString') {
      properties[key] = {
        type: SchemaType.STRING,
        description: v._def.description || ''
      };
    } else if (v._def.typeName === 'ZodBoolean') {
      properties[key] = {
        type: SchemaType.BOOLEAN,
        description: v._def.description || ''
      };
    } else if (v._def.typeName === 'ZodNumber') {
      properties[key] = {
        type: SchemaType.NUMBER,
        description: v._def.description || ''
      };
    } else if (v._def.typeName === 'ZodArray') {
      properties[key] = {
        type: SchemaType.ARRAY,
        description: v._def.description || '',
        items: { type: SchemaType.STRING }
      };
    } else if (v._def.typeName === 'ZodAny' || v._def.typeName === 'ZodObject') {
      properties[key] = {
        type: SchemaType.OBJECT,
        description: v._def.description || ''
      };
    } else {
      properties[key] = {
        type: SchemaType.STRING,
        description: v._def.description || ''
      };
    }
  }

  return {
    type: SchemaType.OBJECT,
    properties,
    required
  };
}

export class GeminiAdapter implements LLMAdapter {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
    this.model = process.env.MODEL || 'gemini-2.5-flash';
  }

  async enviar(mensajes: any[], herramientas: any[]): Promise<any> {
    const systemMsg = mensajes.find((m: any) => m.role === 'system');
    const history: any[] = [];

    for (const msg of mensajes) {
      if (msg.role === 'system') continue;
      if (msg.role === 'user') {
        if (Array.isArray(msg.content)) {
          const parts: any[] = [];
          for (const c of msg.content) {
            if (c.type === 'tool_result') {
              parts.push({
                functionResponse: {
                  name: c.name || herramientas[0]?.name || 'tool',
                  response: { content: c.content }
                }
              });
            } else if (c.text) {
              parts.push({ text: c.text });
            }
          }
          if (parts.length > 0) history.push({ role: 'user', parts });
        } else if (typeof msg.content === 'string') {
          history.push({ role: 'user', parts: [{ text: msg.content }] });
        }
      } else if (msg.role === 'assistant') {
        if (Array.isArray(msg.content)) {
          const parts: any[] = [];
          for (const c of msg.content) {
            if (c.type === 'tool_use') {
              parts.push({
                functionCall: {
                  name: c.name,
                  args: c.input
                }
              });
            } else if (c.type === 'text' && c.text) {
              parts.push({ text: c.text });
            }
          }
          if (parts.length > 0) history.push({ role: 'model', parts });
        } else if (typeof msg.content === 'string') {
          history.push({ role: 'model', parts: [{ text: msg.content }] });
        }
      }
    }

    const tools = herramientas.length > 0 ? [{
      functionDeclarations: herramientas.map((h: any) => ({
        name: h.name,
        description: h.description,
        parameters: zodToGeminiSchema(h.args)
      }))
    }] : undefined;

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemMsg?.content || '',
      tools: tools as any
    });

    const chat = model.startChat({ history });
    const lastUserMsg = [...mensajes].reverse().find((m: any) => m.role === 'user');
    
    let result;
    if (Array.isArray(lastUserMsg?.content) && lastUserMsg.content.some((c: any) => c.type === 'tool_result')) {
      const parts: any[] = [];
      for (const c of lastUserMsg.content) {
        if (c.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: c.name || herramientas[0]?.name || 'tool',
              response: { content: c.content }
            }
          });
        }
      }
      result = await chat.sendMessage(parts);
    } else if (typeof lastUserMsg?.content === 'string') {
      result = await chat.sendMessage(lastUserMsg.content);
    } else {
      result = await chat.sendMessage('Continuar');
    }

    const response = await result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const content: any[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          name: part.functionCall.name,
          input: part.functionCall.args
        });
      }
      if (part.text) {
        content.push({
          type: 'text',
          text: part.text
        });
      }
    }

    if (content.length === 0) {
      try {
        content.push({ type: 'text', text: response.text() || 'Sin respuesta' });
      } catch {
        content.push({ type: 'text', text: 'Sin respuesta' });
      }
    }

    return { content };
  }
}
