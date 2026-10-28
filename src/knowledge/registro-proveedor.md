# Conocimiento del proceso Registro como Proveedor

## Objetivo
Automatizar el llenado de formularios de registro como proveedor, generando el formulario en el formato solicitado y preparando el paquete con soportes para firma humana.

## Fuentes
- fixtures/reto-01/repositorio/maestro.json
- fixtures/reto-01/repositorio/soportes/
- fixtures/reto-01/glosario-campos.json

## Formatos
- xlsx: usar plantilla-celdas.json (hoja + celda_etiqueta + celda_valor)
- pdf: usar plantilla-campos.json (lista de etiquetas obligatorias/opcionales)
- portal: generar valores-portal.md, no automatizar

## Soportes
Verificar vigencia_hasta vs fecha actual. Vencidos bloquean listo_para_firma.

## Confirmación
Siempre pedir confirmación explícita antes de simular envío.
