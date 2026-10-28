import { z } from "zod";
import fs from "fs";
import path from "path";

const FIXTURES_DIR = process.env.FIXTURES_DIR || path.resolve(process.cwd(), "fixtures/reto-01");

export const proveedor_leer_solicitud = {
  description: "Lee la solicitud y plantilla del caso para obtener campos solicitados, país, formato y soportes exigidos",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/reto-01/casos/")
  },
  async execute(args: { caso: string }) {
    try {
      const casoDir = path.join(FIXTURES_DIR, "casos", args.caso);
      if (!fs.existsSync(casoDir)) return JSON.stringify({ ok: false, error: "Caso inexistente" });
      
      const solicitud = JSON.parse(fs.readFileSync(path.join(casoDir, "solicitud.json"), "utf-8"));
      const soportesExigidos = JSON.parse(fs.readFileSync(path.join(casoDir, "soportes-exigidos.json"), "utf-8"));
      
      let campos: any = [];
      if (solicitud.formato === "xlsx") {
        const plantilla = JSON.parse(fs.readFileSync(path.join(casoDir, "plantilla-celdas.json"), "utf-8"));
        campos = plantilla.map((p: any) => p.etiqueta);
      } else if (solicitud.formato === "pdf" || solicitud.formato === "portal") {
        const plantilla = JSON.parse(fs.readFileSync(path.join(casoDir, "plantilla-campos.json"), "utf-8"));
        campos = plantilla.map((p: any) => ({ etiqueta: p.etiqueta, obligatorio: p.obligatorio }));
      }
      
      return JSON.stringify({
        ok: true,
        data: {
          pais: solicitud.pais,
          cliente: solicitud.cliente,
          formato: solicitud.formato,
          campos,
          soportes: soportesExigidos
        }
      });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
};

function getMaestro() {
  const maestroPath = path.join(FIXTURES_DIR, "repositorio", "maestro.json");
  return JSON.parse(fs.readFileSync(maestroPath, "utf-8"));
}

function getGlosario() {
  const glosarioPath = path.join(FIXTURES_DIR, "glosario-campos.json");
  return JSON.parse(fs.readFileSync(glosarioPath, "utf-8"));
}

function resolverValor(maestro: any, clave: string): any {
  if (!clave) return undefined;
  const partes = clave.split(".");
  let actual = maestro;
  for (const p of partes) {
    if (actual && typeof actual === "object" && p in actual) {
      actual = actual[p];
    } else {
      return undefined;
    }
  }
  return actual;
}

export const proveedor_mapear_campos = {
  description: "Mapea campos solicitados al maestro usando glosario",
  args: {
    caso: z.string(),
    campos: z.array(z.any())
  },
  async execute(args: { caso: string, campos: any[] }) {
    try {
      const maestro = getMaestro();
      const glosario = getGlosario();
      const solicitud = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "solicitud.json"), "utf-8"));
      
      const llenos: any[] = [];
      const faltantes: any[] = [];
      const requiere_confirmacion: any[] = [];
      
      for (const campo of args.campos) {
        const etiqueta = typeof campo === "string" ? campo : campo.etiqueta;
        const clave = glosario[etiqueta];
        
        if (!clave) {
          faltantes.push({ etiqueta, razon: "Sin mapeo en glosario" });
          continue;
        }
        
        if (clave === "nit" && solicitud.pais !== "CO") {
          requiere_confirmacion.push({ etiqueta, clave, razon: "Identificador extranjero - usar RUC/RTN según corresponda" });
          const valor = resolverValor(maestro, clave);
          if (valor) llenos.push({ etiqueta, clave, valor: String(valor) + (maestro.digito_verificacion ? "-" + maestro.digito_verificacion : ""), fuente: "maestro." + clave });
          continue;
        }
        
        const valor = resolverValor(maestro, clave);
        if (valor !== undefined && valor !== null) {
          llenos.push({ etiqueta, clave, valor: typeof valor === "object" ? JSON.stringify(valor) : String(valor), fuente: "maestro." + clave });
        } else {
          faltantes.push({ etiqueta, clave, razon: "No existe en maestro" });
        }
      }
      
      return JSON.stringify({ ok: true, data: { llenos, faltantes, requiere_confirmacion } });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
};

export const proveedor_generar_formulario = {
  description: "Genera el formulario en el formato solicitado",
  args: {
    caso: z.string(),
    mapeo: z.any()
  },
  async execute(args: { caso: string, mapeo: any }) {
    try {
      const outDir = path.resolve(process.cwd(), "out", args.caso);
      fs.mkdirSync(outDir, { recursive: true });
      
      const solicitud = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "solicitud.json"), "utf-8"));
      
      if (solicitud.formato === "xlsx") {
        const XLSX = await import("xlsx");
        const plantilla = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "plantilla-celdas.json"), "utf-8"));
        const wb = XLSX.utils.book_new();
        
        const hojas = [...new Set(plantilla.map((p: any) => p.hoja))];
        for (const hoja of hojas) {
          const wsData: any = {};
          for (const item of plantilla.filter((p: any) => p.hoja === hoja)) {
            const lleno = args.mapeo.llenos?.find((l: any) => l.etiqueta === item.etiqueta);
            wsData[item.celda_etiqueta] = { t: "s", v: item.etiqueta };
            if (lleno) {
              wsData[item.celda_valor] = { t: "s", v: lleno.valor };
            }
          }
          const ws: any = {};
          Object.keys(wsData).forEach(k => { ws[k] = wsData[k]; });
          ws["!ref"] = "A1:C20";
          XLSX.utils.book_append_sheet(wb, ws, hoja);
        }
        
        const ruta: string = String(path.join(outDir, "formulario.xlsx"));
        XLSX.writeFile(wb, String(ruta));
        return JSON.stringify({ ok: true, data: { ruta, formato: "xlsx" } });
      } else if (solicitud.formato === "pdf") {
        const { PDFDocument, StandardFonts } = await import("pdf-lib");
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const plantilla = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "plantilla-campos.json"), "utf-8"));
        
        let y = 750;
        page.drawText("Formulario - " + args.caso, { x: 50, y, size: 16, font });
        y -= 30;
        for (const item of plantilla) {
          const lleno = args.mapeo.llenos?.find((l: any) => l.etiqueta === item.etiqueta);
          const texto = item.etiqueta + ": " + (lleno ? lleno.valor : "[FALTANTE]") + (item.obligatorio ? " *" : "");
          page.drawText(texto, { x: 50, y, size: 10, font });
          y -= 15;
          if (y < 50) break;
        }
        
        const pdfBytes = await pdfDoc.save();
        const ruta = path.join(outDir, "formulario.pdf");
        fs.writeFileSync(ruta, pdfBytes);
        return JSON.stringify({ ok: true, data: { ruta, formato: "pdf" } });
      } else if (solicitud.formato === "portal") {
        const plantilla = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "plantilla-campos.json"), "utf-8"));
        let contenido = "# Valores para portal - " + args.caso + "\n\n";
        for (const item of plantilla) {
          const lleno = args.mapeo.llenos?.find((l: any) => l.etiqueta === item.etiqueta);
          contenido += "- " + item.etiqueta + ": " + (lleno ? lleno.valor : "[FALTANTE]") + (item.obligatorio ? " *" : "") + "\n";
        }
        const ruta = path.join(outDir, "valores-portal.md");
        fs.writeFileSync(ruta, contenido);
        return JSON.stringify({ ok: true, data: { ruta, formato: "portal", nota: "formato no soportado - generar valores para copiar" } });
      }
      
      return JSON.stringify({ ok: false, error: "Formato no soportado" });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
};

export const proveedor_armar_paquete = {
  description: "Arma paquete para firma",
  args: {
    caso: z.string()
  },
  async execute(args: { caso: string }) {
    try {
      const outDir = path.resolve(process.cwd(), "out", args.caso);
      const paqueteDir = path.join(outDir, "paquete");
      fs.mkdirSync(paqueteDir, { recursive: true });
      
      const solicitud = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "solicitud.json"), "utf-8"));
      const soportesExigidos = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "casos", args.caso, "soportes-exigidos.json"), "utf-8"));
      const indexSoportes = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "repositorio", "soportes", "index.json"), "utf-8"));
      
      const formXlsx = path.join(outDir, "formulario.xlsx");
      const formPdf = path.join(outDir, "formulario.pdf");
      if (fs.existsSync(formXlsx)) fs.copyFileSync(formXlsx, path.join(paqueteDir, "formulario.xlsx"));
      if (fs.existsSync(formPdf)) fs.copyFileSync(formPdf, path.join(paqueteDir, "formulario.pdf"));
      
      const checklist: any[] = [];
      const hoy = new Date();
                        const soportesArr: any[] = Array.isArray(soportesExigidos) ? soportesExigidos : [];
      for (const tipo of soportesArr) {
        const info = (indexSoportes as any[]).find((s: any) => s.tipo === tipo);
        const infoAny: any = info;
        if (infoAny && infoAny.archivo) {
          const arch = String(infoAny.archivo);
          const srcSoporte = path.join(FIXTURES_DIR, "repositorio", "soportes", arch);
          if (fs.existsSync(srcSoporte)) { fs.copyFileSync(srcSoporte, path.join(paqueteDir, arch)); }
          const vencido = infoAny.vigencia_hasta ? new Date(String(infoAny.vigencia_hasta)).getTime() < Date.now() : false;
          checklist.push({ tipo: tipo, archivo: arch, presente: true, vencido, vigencia_hasta: infoAny.vigencia_hasta });
        } else {
          checklist.push({ tipo: tipo, presente: false, vencido: false });
        }
      }
      
      const vencidos = checklist.filter(c => c.vencido).length;
      const ausentes = checklist.filter(c => !c.presente).length;
      const listo_para_firma = vencidos === 0 && ausentes === 0;
      
      let checklistMd = "# Checklist de soportes - " + args.caso + "\n\n";
      for (const c of checklist) {
        checklistMd += "- [" + (c.presente ? "x" : " ") + "] " + c.tipo + (c.presente ? " (" + c.archivo + ")" : " - AUSENTE") + (c.vencido ? " - VENCIDO" : "") + (c.vigencia_hasta ? " (vence: " + c.vigencia_hasta + ")" : "") + "\n";
      }
      checklistMd += "\n**Estado:** " + (listo_para_firma ? "LISTO PARA FIRMA" : "NO LISTO - Revisar soportes") + "\n";
      fs.writeFileSync(path.join(paqueteDir, "checklist.md"), checklistMd);
      
      const borrador = "# Borrador de correo - " + args.caso + "\n\nPara: " + solicitud.para + "\nAsunto: Re: " + solicitud.asunto + "\n\nEstimados:\n\nAdjuntamos formulario diligenciado y soportes para continuar con el proceso de registro como proveedor.\n\nQuedamos atentos a su confirmación.\n\nAtentamente,\nPeriferia IT Group S.A.S.\n";
      fs.writeFileSync(path.join(paqueteDir, "borrador-correo.md"), borrador);
      
      return JSON.stringify({ ok: true, data: { ruta: paqueteDir, listo_para_firma, checklist } });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
};

export const proveedor_simular_envio = {
  description: "Simula envío - SOLO con confirmación explícita",
  args: {
    caso: z.string(),
    confirmado: z.boolean()
  },
  async execute(args: { caso: string, confirmado: boolean }) {
    try {
      if (!args.confirmado) {
        return JSON.stringify({ ok: false, error: "requiere confirmación explícita" });
      }
      const outDir = path.resolve(process.cwd(), "out", args.caso);
      const ruta = path.join(outDir, "ENVIO-SIMULADO.md");
      const contenido = "# ENVIO SIMULADO - " + args.caso + "\n\nFecha: " + new Date().toISOString() + "\nEstado: Enviado (simulado)\n\nEste archivo indica que se habría enviado tras confirmación explícita del usuario.\n";
      fs.writeFileSync(ruta, contenido);
      return JSON.stringify({ ok: true, data: { ruta } });
    } catch (e: any) {
      return JSON.stringify({ ok: false, error: e.message });
    }
  }
};














