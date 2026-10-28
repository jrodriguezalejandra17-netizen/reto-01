import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { GeminiAdapter } from './llm/gemini.js';
import * as proveedorTools from './tools/proveedor.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('web'));

const sessions = new Map<string, any[]>();
const llm = new GeminiAdapter();

const tools = Object.entries(proveedorTools).map(([name, tool]: [string, any]) => ({
  name: 'proveedor_' + name.replace('proveedor_', ''),
  ...tool
}));

const systemPrompt = fs.readFileSync(path.resolve('agent/prompt.md'), 'utf-8');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: 'google-gemini', model: process.env.MODEL || 'gemini-2.5-flash' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId = 'default', message } = req.body;
    
    let history = sessions.get(sessionId);
    if (!history) {
      history = [{ role: 'system', content: systemPrompt }];
      sessions.set(sessionId, history);
    }
    
    history.push({ role: 'user', content: String(message || '') });
    
    const toolCalls: any[] = [];
    let iterations = 0;
    const maxIterations = parseInt(process.env.MAX_ITERATIONS || '25');
    let needsConfirmation = false;
    
    while (iterations < maxIterations) {
      iterations++;
      try {
        const response = await llm.enviar(history, tools);
        
        let hasToolUse = false;
        if (response && response.content) {
          for (const block of response.content) {
            if (block.type === 'tool_use') {
              hasToolUse = true;
              const toolName = block.name;
              const toolArgs = block.input;
              
              const tool = tools.find(t => t.name === toolName);
              if (tool) {
                try {
                  const result = await tool.execute(toolArgs || {});
                  const resultObj = JSON.parse(result);
                  toolCalls.push({ name: toolName, args: toolArgs, result: resultObj });
                  
                  try { fs.mkdirSync(path.resolve('out'), { recursive: true }); } catch {}
                  const logLine = JSON.stringify({ ts: new Date().toISOString(), herramienta: toolName, ok: resultObj.ok, resumen: JSON.stringify(resultObj).substring(0, 100) }) + '\n';
                  try { fs.appendFileSync(path.resolve('out/log.jsonl'), logLine); } catch {}
                  
                  history.push({
                    role: 'assistant',
                    content: [{ type: 'tool_use', id: block.id, name: toolName, input: toolArgs }]
                  });
                  history.push({
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: block.id, name: toolName, content: result }]
                  });
                } catch (e: any) {
                  history.push({
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: block.id, name: toolName, content: JSON.stringify({ ok: false, error: e.message }) }]
                  });
                }
              } else {
                history.push({
                  role: 'user',
                  content: [{ type: 'tool_result', tool_use_id: 'unknown', name: toolName, content: JSON.stringify({ ok: false, error: 'Herramienta no encontrada' }) }]
                });
              }
            }
          }
        }
        
        if (!hasToolUse) {
          const textContent = response?.content?.find((b: any) => b.type === 'text');
          const reply = textContent?.text || 'Sin respuesta';
          if (reply.includes('¿Confirmas') || reply.toLowerCase().includes('confirmación') || reply.toLowerCase().includes('confirma')) {
            needsConfirmation = true;
          }
          history.push({ role: 'assistant', content: reply });
          return res.json({ reply, toolCalls, needsConfirmation });
        }
      } catch (e: any) {
        return res.status(500).json({ error: 'Error LLM: ' + e.message });
      }
    }
    
    const lastReply = 'Límite de iteraciones alcanzado. Proceso detenido.';
    history.push({ role: 'assistant', content: lastReply });
    return res.json({ reply: lastReply, toolCalls, needsConfirmation: false });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  const history = sessions.get(req.params.id) || [];
  res.json({ history });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor corriendo en http://localhost:' + PORT);
});
