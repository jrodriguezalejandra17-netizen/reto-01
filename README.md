# Reto 01 - Agente conversacional Registro como Proveedor

## Levantar en local
`ash
npm install
cp .env.example .env
# Añade GOOGLE_API_KEY en .env (Google AI Studio)
npm run dev
`

Front: http://localhost:3000  
API: http://localhost:3000/api/health

## Demo sin modelo
`ash
npm run demo
`

## Variables requeridas
- GOOGLE_API_KEY (Google AI Studio, solo backend)
- MODEL (opcional, default gemini-2.5-flash)
- PORT (opcional, default 3000)
