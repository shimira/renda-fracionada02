// Armazenamento assíncrono de comprovantes em IndexedDB (alta performance, sem travar Safari/localStorage)

const DB_NAME = 'RendaFracionadaReceiptsDB';
const DB_VERSION = 1;
const STORE_NAME = 'receipts';
const URL_CACHE_LIMIT = 30;

let dbPromise = null;
const urlCache = new Map();

function openReceiptsDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function compressImageFile(file, maxSide = 1400, quality = 0.80) {
  const bitmapOrImg = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const srcW = bitmapOrImg.naturalWidth || bitmapOrImg.width;
  const srcH = bitmapOrImg.naturalHeight || bitmapOrImg.height;
  let dstW = srcW;
  let dstH = srcH;
  if (srcW > maxSide || srcH > maxSide) {
    const ratio = maxSide / Math.max(srcW, srcH);
    dstW = Math.max(1, Math.round(srcW * ratio));
    dstH = Math.max(1, Math.round(srcH * ratio));
  }

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, dstW, dstH);
  ctx.drawImage(bitmapOrImg, 0, 0, dstW, dstH);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao comprimir imagem'));
      },
      'image/jpeg',
      quality
    );
  });
}

export async function saveReceiptBlob(file, yearMonth, labelHint) {
  const blob = await compressImageFile(file);
  const safeYm = String(yearMonth || 'geral').replace(/[^0-9-]/g, '') || 'geral';
  const slug = String(labelHint || 'comprovante')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'comprovante';

  const ts = Date.now();
  const fileName = `comp_${ts}_${slug}.jpg`;
  const relativePath = `Comprovantes/${safeYm}/${fileName}`;
  const blobKey = `${ts}_${Math.random().toString(36).slice(2, 8)}`;

  const db = await openReceiptsDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key: blobKey, blob, fileName, relativePath, createdAt: ts });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const objectUrl = URL.createObjectURL(blob);
  rememberCachedUrl(blobKey, objectUrl);

  return {
    id: 0,
    fileName,
    relativePath,
    fullPath: `App://${relativePath}`,
    blobKey,
    note: String(labelHint || '').trim(),
    createdAt: ts
  };
}

function rememberCachedUrl(key, url) {
  if (urlCache.has(key)) {
    const old = urlCache.get(key);
    if (old !== url) URL.revokeObjectURL(old);
    urlCache.delete(key);
  }
  urlCache.set(key, url);
  while (urlCache.size > URL_CACHE_LIMIT) {
    const oldestKey = urlCache.keys().next().value;
    const oldestUrl = urlCache.get(oldestKey);
    urlCache.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }
}

export async function getReceiptBlob(blobKey) {
  if (!blobKey) return null;
  const db = await openReceiptsDb();
  return await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(blobKey);
    req.onsuccess = () => resolve(req.result?.blob || null);
    req.onerror = () => resolve(null);
  });
}

export async function getReceiptObjectUrl(blobKey) {
  if (!blobKey) return null;
  if (urlCache.has(blobKey)) {
    const existing = urlCache.get(blobKey);
    urlCache.delete(blobKey);
    urlCache.set(blobKey, existing);
    return existing;
  }
  const blob = await getReceiptBlob(blobKey);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  rememberCachedUrl(blobKey, url);
  return url;
}

export async function deleteReceiptBlob(blobKey) {
  if (!blobKey) return;
  if (urlCache.has(blobKey)) {
    URL.revokeObjectURL(urlCache.get(blobKey));
    urlCache.delete(blobKey);
  }
  try {
    const db = await openReceiptsDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(blobKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function clearAllReceipts() {
  for (const url of urlCache.values()) {
    URL.revokeObjectURL(url);
  }
  urlCache.clear();
  try {
    const db = await openReceiptsDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export async function shareOrDownloadReceipt(receipt) {
  const blob = await getReceiptBlob(receipt.blobKey);
  if (!blob) return false;

  const file = new File([blob], receipt.fileName, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: receipt.fileName,
        text: `Comprovante (${receipt.relativePath})`,
        files: [file]
      });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = receipt.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
