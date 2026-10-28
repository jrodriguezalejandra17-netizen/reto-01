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
const pendingConfirmations = new Map<string, string>();
const llm = new GeminiAdapter();

const tools = Object.entries(proveedorTools).map(([name, tool]: [string, any]) => ({
  name: 'proveedor_' + name.replace('proveedor_', ''),
  ...tool
}));

const systemPrompt = fs.readFileSync(path.resolve('agent/prompt.md'), 'utf-8');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: 'google-gemini', model: process.env.MODEL || 'gemini-1.5-flash' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId = 'default', message } = req.body;
    const msg = String(message || '');

    let history = sessions.get(sessionId);
    if (!history) {
      history = [{ role: 'system', content: systemPrompt }];
      sessions.set(sessionId, history);
    }

    const matchCaso = msg.match(/procesa el caso ["']?([a-zA-Z0-9-]+)["']?/i);
    if (matchCaso) {
      const caso = matchCaso[1];
      const toolCalls: any[] = [];

      try {
        fs.mkdirSync(path.resolve('out'), { recursive: true });

        const leerRes = await (proveedorTools as any).proveedor_leer_solicitud.execute({ caso });
        const leer = JSON.parse(leerRes);
        toolCalls.push({ name: 'proveedor_leer_solicitud', args: { caso }, result: leer });

        if (!leer.ok) {
          return res.json({ reply: 'Error al leer the solicitud: ' + leer.error, toolCalls, needsConfirmation: false });
        }

        const mapRes = await (proveedorTools as any).proveedor_mapear_campos.execute({ caso, campos: leer.data.campos });
        const map = JSON.parse(mapRes);
        toolCalls.push({ name: 'proveedor_mapear_campos', args: { caso, campos: leer.data.campos }, result: map });

        if (!map.ok) {
          return res.json({ reply: 'Error al mapear campos: ' + map.error, toolCalls, needsConfirmation: false });
        }

        const genRes = await (proveedorTools as any).proveedor_generar_formulario.execute({ caso, mapeo: map.data });
        const gen = JSON.parse(genRes);
        toolCalls.push({ name: 'proveedor_generar_formulario', args: { caso, mapeo: map.data }, result: gen });

        const pkgRes = await (proveedorTools as any).proveedor_armar_paquete.execute({ caso });
        const pkg = JSON.parse(pkgRes);
        toolCalls.push({ name: 'proveedor_armar_paquete', args: { caso }, result: pkg });

        const llenos = map.data.llenos?.length || 0;
        const faltantes = map.data.faltantes?.length || 0;
        const reqConf = map.data.requiere_confirmacion?.length || 0;
        const listo = pkg.data?.listo_para_firma ? 'SI' : 'NO';
        const formato = leer.data.formato;
        const rutaBase = 'out/' + caso + '/';

        let reply = '## Resultado - Caso ' + caso + '\n\n';
        reply += '**Cliente:** ' + leer.data.cliente + ' | **País:** ' + leer.data.pais + ' | **Formato:** ' + formato + '\n\n';
        reply += '### Mapeo de campos\n';
        reply += '- Campos llenos: ' + llenos + '\n';
        reply += '- Campos faltantes: ' + faltantes + '\n';
        reply += '- Requiere confirmación: ' + reqConf + '\n\n';

        if (map.data.faltantes && map.data.faltantes.length > 0) {
          reply += '**Faltantes:**\n';
          for (const f of map.data.faltantes) {
            reply += '- ' + f.etiqueta + ' (' + f.razon + ')\n';
          }
          reply += '\n';
        }

        if (map.data.requiere_confirmacion && map.data.requiere_confirmacion.length > 0) {
          reply += '**Requiere confirmación:**\n';
          for (const r of map.data.requiere_confirmacion) {
            reply += '- ' + r.etiqueta + ': ' + r.razon + '\n';
          }
          reply += '\n';
        }

        reply += '### Generación\n';
        let nombreForm = 'formulario.xlsx';
        if (formato === 'pdf') nombreForm = 'formulario.pdf';
        if (formato === 'portal') nombreForm = 'valores-portal.md';
        reply += '- Formulario generado en: ' + rutaBase + nombreForm + '\n\n';

        reply += '### Paquete para firma\n';
        reply += '- Ruta: ' + rutaBase + 'paquete/\n';
        reply += '- Listo para firma: ' + listo + '\n\n';

        reply += '### Soportes\n';
        if (pkg.data && pkg.data.checklist) {
          for (const c of pkg.data.checklist) {
            if (c.presente) {
              reply += '- [x] ' + c.tipo + ' (' + c.archivo + ')' + (c.vencido ? ' - VENCIDO' : (c.vigencia_hasta ? ' (vence: ' + c.vigencia_hasta + ')' : '')) + '\n';
            } else {
              reply += '- [ ] ' + c.tipo + ' - AUSENTE\n';
            }
          }
        }
        reply += '\n';

        reply += '**¿Confirmas que deseas continuar con la simulación de envío?** Responde: "Sí, confirmo"';

        pendingConfirmations.set(sessionId, caso);
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: reply });

        return res.json({ reply: reply, toolCalls: toolCalls, needsConfirmation: true });
      } catch (e: any) {
        return res.json({ reply: 'Error en ejecución directa: ' + e.message, toolCalls: toolCalls, needsConfirmation: false });
      }
    }

    const normalizedMessage = msg
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const confirmed = /^(si|confirmo|si[,!. ]+confirmo)\b/.test(normalizedMessage);
    const casoPendiente = pendingConfirmations.get(sessionId);

    if (confirmed && casoPendiente) {
      try {
        const simRes = await (proveedorTools as any).proveedor_simular_envio.execute({ caso: casoPendiente, confirmado: true });
        const sim = JSON.parse(simRes);
        if (!sim.ok) {
          return res.json({ reply: 'No fue posible registrar la simulación: ' + sim.error, toolCalls: [{ name: 'proveedor_simular_envio', args: { caso: casoPendiente, confirmado: true }, result: sim }], needsConfirmation: true });
        }

        pendingConfirmations.delete(sessionId);
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: 'Simulación de envío completada para ' + casoPendiente + '.' });
        return res.json({ reply: 'Simulación de envío completada.\n\nArchivo generado: out/' + casoPendiente + '/ENVIO-SIMULADO.md\n\nNo se ha enviado nada a sistemas reales.', toolCalls: [{ name: 'proveedor_simular_envio', args: { caso: casoPendiente, confirmado: true }, result: sim }], needsConfirmation: false });
      } catch (e: any) {
        return res.json({ reply: 'Error al simular envío: ' + e.message, toolCalls: [], needsConfirmation: true });
      }
    }

    if (confirmed) {
      return res.json({ reply: 'No hay una confirmación pendiente en esta sesión. Procesa un caso y confirma en el mismo chat.', toolCalls: [], needsConfirmation: false });
    }

    history.push({ role: 'user', content: msg });

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
              const tool = tools.find((t: any) => t.name === toolName);
              if (tool) {
                try {
                  const result = await tool.execute(toolArgs || {});
                  const resultObj = JSON.parse(result);
                  toolCalls.push({ name: toolName, args: toolArgs, result: resultObj });
                  try { fs.mkdirSync(path.resolve('out'), { recursive: true }); } catch {}
                  const logLine = JSON.stringify({ ts: new Date().toISOString(), herramienta: toolName, ok: resultObj.ok }) + '\n';
                  try { fs.appendFileSync(path.resolve('out/log.jsonl'), logLine); } catch {}
                  history.push({ role: 'assistant', content: [{ type: 'tool_use', id: block.id, name: toolName, input: toolArgs }] });
                  history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, name: toolName, content: result }] });
                } catch (e: any) {
                  history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, name: toolName, content: JSON.stringify({ ok: false, error: e.message }) }] });
                }
              }
            }
          }
        }
        if (!hasToolUse) {
          const textContent = response?.content?.find((b: any) => b.type === 'text');
          const reply = textContent?.text || 'Sin respuesta';
          if (reply.toLowerCase().indexOf('confirma') >= 0) needsConfirmation = true;
          history.push({ role: 'assistant', content: reply });
          return res.json({ reply: reply, toolCalls: toolCalls, needsConfirmation: needsConfirmation });
        }
      } catch (e: any) {
        return res.status(500).json({ error: 'Error LLM: ' + e.message });
      }
    }

    const lastReply = 'Límite de iteraciones alcanzado.';
    history.push({ role: 'assistant', content: lastReply });
    return res.json({ reply: lastReply, toolCalls: toolCalls, needsConfirmation: false });
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
