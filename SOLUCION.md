# SOLUCION.md

## 1. Problema en una frase
Automatizar el llenado de formularios de registro como proveedor ante clientes, reduciendo la transcripción manual, haciendo explícito lo que falta y preparando el paquete para firma humana, sin firmar ni enviar.

**A quién le duele:** Al área administrativa de Periferia IT Group, que pierde tiempo transcribiendo 8-12 formularios mensuales con datos que ya existen en su repositorio interno.

## 2. Arquitectura
`
Front (web/index.html) --HTTP/JSON--> Backend (src/server.ts)
                                        |-- Ciclo agente
                                        |-- Adaptador LLM (src/llm/anthropic.ts)
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
5. Detectar si respuesta pide confirmación explícita (¿Confirmas...) y marcar 
eedsConfirmation
6. Solo con confirmación explícita del usuario siguiente turno, se puede llamar proveedor_simular_envio con confirmado: true

## 4. Elección del modelo
- **Proveedor:** Anthropic (Claude)
- **Modelo:** claude-3-5-sonnet-20240620 (configurable via env)
- **Por qué:** Buen soporte de tool use, razonamiento claro, adecuado para seguir instrucciones estrictas
- **Costo estimado:** ~\.003/\.015 por 1K tokens. Un caso procesado completo ~\.01-0.05 aprox.

## 5. Diseño del portal web
**Estrategia:**
- El agente NO automatiza el portal. Genera alores-portal.md con todos los campos listos para copiar/pegar
- Para automatización futura: usar navegador controlado (Playwright/Puppeteer) pero requiere manejo de sesión
- **Límites:** CAPTCHA, MFA/2FA, cambios frecuentes de layout, rate limiting
- **Credenciales:** NUNCA en repo, prompt, logs o front. Deben ingresarse manualmente por el usuario en el portal. El agente solo proporciona valores.
- **División:** Agente prepara valores + checklist soportes. Humano ingresa credenciales, completa campos, sube archivos, acepta términos y hace clic en "Enviar/Guardar".

## 6. Decisiones y trade-offs
| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **Herramientas tipadas con zod** | Pasar strings sin validar | Obligatorio según PRD. Validación temprana evita errores al modelo |
| **Archivos JSON/texto como fixtures** | Base de datos | Más simple, determinista, sin dependencias externas. Suficiente para el reto |
| **Generar PDF con pdf-lib** | Usar plantillas AcroForm | Más portable, no requiere rellenar campos interactivos. Cumple "reproduce todos los campos con etiqueta y valor" |
| **Un solo adaptador LLM** | Hardcodear llamadas | Permite cambiar proveedor fácilmente sin tocar ciclo del agente |

## 7. Supuestos
- Los fixtures representan la variabilidad real
- glosario-campos.json cubre los sinónimos principales
- Los soportes en epositorio/soportes/ son los disponibles para Periferia
- Fechas de vigencia son comparables con fecha de ejecución
- Para PDF/Excel se puede generar sin plantillas exactas del cliente

## 8. Cobertura
| Historia | Estado | Notas |
|---|---|---|
| HU-1 Leer solicitud | Hecho | Soporta xlsx, pdf, portal |
| HU-2 Mapear campos al maestro | Hecho | Usa glosario, marca faltantes/requiere_confirmacion |
| HU-3 Generar formulario | Hecho | xlsx funcional, pdf generado, portal genera valores-portal.md |
| HU-4 Armar paquete para firma | Hecho | Copia soportes, checklist con vigencias, borrador correo, pide confirmación |
| HU-5 Manejo de errores | Hecho | Herramientas devuelven {ok,error}, sin excepciones al agente |

**Falta para producción:** Integración real con correo/SharePoint, autenticación, BD, automatización portal con credenciales seguras, firma electrónica.

## 9. Uso de IA
**Asistentes usados:** Claude (este asistente)

**Para qué:**
- Diseño de arquitectura siguiendo PRD
- Implementación de herramientas tipadas con zod
- Lógica de mapeo con glosario
- Generación de xlsx/pdf
- Frontend de chat
- Documentación

**Descartado:** Generación automática de plantillas Excel exactas copiando formato complejo. Decidí generar estructura simple pero funcional que cumple los criterios.

## 10. Riesgos
| Riesgo | Mitigación |
|---|---|
| Modelo inventa valores | Herramientas son única fuente, prompt prohíbe inventar, todo pasa por mapeo |
| Clave expuesta | Solo en .env backend, .env.example sin valores, nunca en front/logs |
| Soportes vencidos | Validación por vigencia_hasta, bloquea listo_para_firma |
| Envío accidental | Requiere confirmación explícita en turno siguiente, solo simulado |
