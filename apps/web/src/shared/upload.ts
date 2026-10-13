import { api } from './api';
import type { FileDto } from './types';

/** ЗАК-33: фото сжимаются на устройстве до 2560 px по длинной стороне перед загрузкой. */
export async function compressImage(file: File, maxSide = 2560, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadFile(file: File, link: { orderId?: string; visitId?: string }): Promise<FileDto> {
  const prepared = await compressImage(file);
  return api.upload<FileDto>('/files', prepared, link);
}
