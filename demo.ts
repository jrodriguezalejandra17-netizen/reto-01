import * as proveedorTools from "./src/tools/proveedor.js";
import fs from "fs";

const casos = ["co-industrias-delta", "ec-corp-andina", "hn-agroexport-sula", "pa-logistica-istmo"];

console.log("=== DEMO - Herramientas sin modelo ===\n");

if (fs.existsSync("./out")) {
  fs.rmSync("./out", { recursive: true, force: true });
}
fs.mkdirSync("./out", { recursive: true });

for (const caso of casos) {
  console.log("\n--- Procesando " + caso + " ---");
  try {
    const leerRes = await (proveedorTools as any).proveedor_leer_solicitud.execute({ caso });
    const leer = JSON.parse(leerRes);
    console.log("1. Leer solicitud:", leer.ok ? "OK" : "FAIL", leer.data ? "formato:" + leer.data.formato + ", pais:" + leer.data.pais : leer.error);

    if (!leer.ok) continue;

    const mapRes = await (proveedorTools as any).proveedor_mapear_campos.execute({ caso, campos: leer.data.campos });
    const map = JSON.parse(mapRes);
    console.log("2. Mapear campos:", map.ok ? "OK" : "FAIL");
    if (map.ok) {
      console.log("   Llenos: " + map.data.llenos.length + ", Faltantes: " + map.data.faltantes.length + ", Requiere confirmacion: " + map.data.requiere_confirmacion.length);
    }

    if (!map.ok) continue;

    const genRes = await (proveedorTools as any).proveedor_generar_formulario.execute({ caso, mapeo: map.data });
    const gen = JSON.parse(genRes);
    console.log("3. Generar formulario:", gen.ok ? "OK" : "FAIL", gen.data ? gen.data.ruta : gen.error);

    const pkgRes = await (proveedorTools as any).proveedor_armar_paquete.execute({ caso });
    const pkg = JSON.parse(pkgRes);
    console.log("4. Armar paquete:", pkg.ok ? "OK" : "FAIL");
    if (pkg.ok) {
      console.log("   Listo para firma: " + (pkg.data.listo_para_firma ? "SI" : "NO"));
    }
  } catch (e: any) {
    console.log("ERROR:", e?.message || e);
  }
}

console.log("\n=== Demo completado ===");
console.log("Revisar carpeta out/");
