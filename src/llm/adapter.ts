import { z } from 'zod';

export interface LLMAdapter {
  enviar(mensajes: any[], herramientas: any[]): Promise<any>;
}
