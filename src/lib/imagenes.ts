// Imágenes pegadas o soltadas en el panel de Claude. La API admite hasta 5 MB por imagen en
// base64; las grandes se reducen a 2000 px por el lado largo y se pasan a JPEG.

export interface ImagenAdjunta {
  id: number;
  nombre: string;
  /** Tipo MIME que se manda (image/png, image/jpeg…). */
  tipo: string;
  /** base64 sin el prefijo «data:». */
  datos: string;
  /** Para la miniatura. */
  url: string;
}

const TIPOS = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_BYTES = 3_700_000; // ~5 MB en base64
const LADO = 2000;
export const MAX_IMAGENES = 8;

let contador = 0;

const comoUrl = (b: Blob) =>
  new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(b);
  });

async function reducir(archivo: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO / Math.max(bmp.width, bmp.height));
  const lienzo = new OffscreenCanvas(Math.round(bmp.width * escala), Math.round(bmp.height * escala));
  lienzo.getContext("2d")!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close();
  return lienzo.convertToBlob({ type: "image/jpeg", quality: 0.88 });
}

/** null si no es una imagen que Claude entienda. */
export async function leerImagen(archivo: File): Promise<ImagenAdjunta | null> {
  if (!TIPOS.includes(archivo.type)) return null;
  let blob: Blob = archivo;
  if (archivo.size > MAX_BYTES) blob = await reducir(archivo);
  const url = await comoUrl(blob);
  return {
    id: ++contador,
    nombre: archivo.name || "imagen pegada",
    tipo: blob.type,
    datos: url.slice(url.indexOf(",") + 1),
    url,
  };
}

/** Las imágenes de un pegado o de un soltar (lo demás se ignora). */
export async function imagenesDe(lista: FileList | File[] | null | undefined): Promise<ImagenAdjunta[]> {
  const archivos = [...(lista ?? [])].filter((f) => TIPOS.includes(f.type));
  const leidas = await Promise.all(archivos.map((f) => leerImagen(f).catch(() => null)));
  return leidas.filter((x): x is ImagenAdjunta => x !== null);
}
