// Reduce las fotos antes de subirlas: máximo 2000 px y JPEG, para ahorrar
// espacio en Supabase (unos 300-500 KB por foto en lugar de varios MB).
export async function comprimirFoto(archivo: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
    throw new Error(`"${archivo.name}" no es una imagen JPG, PNG o WEBP. Si es una foto HEIC del iPhone, envíala como JPG.`);
  }
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext('2d')!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close();
  return await new Promise((ok, mal) =>
    lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se ha podido procesar la foto.'))), 'image/jpeg', 0.82));
}
