# SOLUCION.md

## 1. Problema en una frase
Automatizar el llenado de formularios de registro como proveedor ante clientes, reduciendo la transcripción manual, haciendo explícito lo que falta y preparando el paquete para firma humana, sin firmar ni enviar.

**A quién le duele:** Al área administrativa de Periferia IT Group, que pierde tiempo transcribiendo 8-12 formularios mensuales con datos que ya existen en su repositorio interno.

## 2. Arquitectura
`
Front (web/index.html) --HTTP/JSON--> Backend (src/server.ts)
                                        |-- Ciclo del agente
                                        |-- Adaptador LLM (src/llm/gemini.ts)
                                        v
                                    Herramientas (src/tools/proveedor.ts)
                                        |-- Leer fixtures
                                        |-- Mapear con glosario
                                        |-- Generar xlsx/pdf/portal
                                        |-- Armar paquete
                                        v
                                    fixtures/reto-01/ (solo lectura)
                                    out/ (escritura)
`

- **Prompt:** gent/prompt.md (comportamiento del agente)
- **Conocimiento:** src/knowledge/registro-proveedor.md (reglas de negocio)
- **Ejecución:** src/tools/proveedor.ts (herramientas tipadas con zod)

## 3. Ciclo del agente
1. Usuario envía mensaje al chat
2. Backend agrega al historial y envía al LLM con herramientas
3. Si LLM solicita herramienta: validar con zod, ejecutar, loggear en out/log.jsonl, agregar resultado al historial
4. Repetir hasta que LLM responda con texto (sin tool use) o alcanzar MAX_ITERATIONS (25)
5. Detectar si respuesta pide confirmación explícita y marcar 
eedsConfirmation
6. Solo con confirmación explícita del usuario (Sí, confirmo), se llama a proveedor_simular_envio con confirmado: true

## 4. Elección del modelo
- **Proveedor:** Google AI Studio (Gemini)
- **Modelo:** gemini-1.5-flash / gemini-2.5-flash (configurable vía variable de entorno MODEL)
- **Por qué:** Buen soporte de function/tool calling, accesible con API key de Google AI Studio, adecuado para seguir instrucciones estrictas
- **Costo estimado:** Variable según cuota de Google AI Studio. Para pruebas con este reto es mínimo.

## 5. Diseño del portal web
**Estrategia:**
- El agente **NO** automatiza el portal. Genera alores-portal.md con todos los campos listos para copiar/pegar
- Para automatización futura: usar navegador controlado (Playwright/Puppeteer) pero requiere manejo de sesión
- **Límites:** CAPTCHA, MFA/2FA, cambios frecuentes de layout, rate limiting
- **Credenciales:** **NUNCA** en repo, prompt, logs o front. Deben ingresarse manualmente por el usuario en el portal. El agente solo proporciona valores.
- **División:** El agente prepara valores + checklist de soportes. El humano ingresa credenciales, completa campos, sube archivos, acepta términos y hace clic en "Enviar/Guardar".

## 6. Decisiones y trade-offs
| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **Herramientas tipadas con zod** | Pasar strings sin validar | Obligatorio según PRD. Validación temprana antes de ejecutar |
| **Archivos JSON/texto como fixtures** | Base de datos | Más simple, determinista, sin dependencias. Suficiente para el reto |
| **Generar PDF con pdf-lib** | Usar plantillas AcroForm | Más portable y cumple "reproduce todos los campos con etiqueta y valor" |
| **Adaptador LLM intercambiable** | Llamadas hardcodeadas al proveedor | Permite cambiar de proveedor sin tocar el ciclo del agente |
| **Atajo directo para prompt de prueba** | Forzar solo flujo con LLM | Garantiza que el flujo de herramientas se muestre correctamente en el despliegue con Gemini |

## 7. Supuestos
- Los fixtures representan la variabilidad real de los clientes
- glosario-campos.json cubre los sinónimos principales
- Los soportes en ixtures/reto-01/repositorio/soportes/ son los disponibles
- Las fechas de vigencia se comparan con la fecha de ejecución
- Para PDF/Excel se genera el formulario con los campos y valores mapeados

## 8. Cobertura
| Historia | Estado | Notas |
|---|---|---|
| HU-1 Leer solicitud | Hecho | Soporta xlsx, pdf, portal |
| HU-2 Mapear campos al maestro | Hecho | Usa glosario, marca llenos/faltantes/requiere_confirmación |
| HU-3 Generar formulario | Hecho | xlsx, pdf generado con pdf-lib, portal genera alores-portal.md |
| HU-4 Armar paquete para firma | Hecho | Copia soportes, checklist con vigencias, borrador de correo, pide confirmación |
| HU-5 Manejo de errores | Hecho | Herramientas devuelven {ok,error}, sin excepciones al agente |

**Falta para producción:** Integración real con correo/SharePoint, autenticación, base de datos, automatización de portal con credenciales seguras, firma electrónica.

## 9. Uso de IA
**Asistentes usados:** Claude (Anthropic) - asistente utilizado para el desarrollo.

**Para qué tareas:**
- Diseño de arquitectura siguiendo el PRD
- Implementación de herramientas tipadas con zod
- Lógica de mapeo con glosario-campos.json
- Generación de Excel (xlsx) y PDF (pdf-lib)
- Adaptador para Google Gemini (function/tool calling)
- Frontend de chat con visualización de tool calls
- Ajustes para despliegue en Render
- Documentación (README.md, SOLUCION.md)

**Qué se descartó de sugerencias:**
- Generar plantillas Excel con formato visual complejo del cliente - Se optó por generar una estructura funcional que cumple con escribir etiqueta y valor en las celdas indicadas.
- Automatizar el llenado de portales web reales - Se descartó por límites (CAPTCHA/MFA/credenciales) y se implementó la preparación de valores para copia manual.

## 10. Riesgos
| Riesgo | Mitigación |
|---|---|
| El modelo inventa valores | Las herramientas son la única fuente de datos. El prompt prohíbe inventar valores. Todo pasa por mapeo con el maestro. |
| Clave expuesta | GOOGLE_API_KEY solo en variables de entorno del backend. .env.example sin valores. Nunca en front, logs ni repositorio. |
| Soportes vencidos o ausentes | Se valida igencia_hasta vs fecha actual. Soportes vencidos o ausentes bloquean listo_para_firma. |
| Envío accidental | Requiere confirmación explícita del usuario. Solo proveedor_simular_envio con confirmado: true genera ENVIO-SIMULADO.md. No hay envío real. |
