import { textFromPdfItems } from './pdf-text.js';
import { readingRegions } from './ocr-layout.js';
import { listeningFromOcr } from './ocr-script.js';
import { deviceProfile } from './tts-runtime.js';

export function fileKind(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) return 'text';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)) return 'image';
  throw new Error('PDF, JPG, PNG, WEBP, TXT 파일만 지원합니다.');
}

export function createFileReader(signal, progress) {
  const { maxOcrPixels } = deviceProfile(globalThis.navigator);
  let ocr;
  let pdf;
  const abort = () => {
    void ocr?.terminate().catch(() => {});
    void pdf?.destroy().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  async function recognize(image, paper = false) {
    signal.throwIfAborted();
    if (!ocr) {
      progress('글자 인식 모델 준비 중');
      const { createWorker } = await import('tesseract.js');
      ocr = await createWorker(paper ? 'kor+eng' : 'eng+kor', 1, {
        logger: p => { if (p.status === 'recognizing text') progress(`글자 인식 ${Math.round(p.progress * 100)}%`); },
      });
      // A question paper contains figures and tables, not a uniform text block.
      await ocr.setParameters({ tessedit_pageseg_mode: paper ? '3' : '6' });
    }
    signal.throwIfAborted();
    const owned = !(image instanceof HTMLCanvasElement);
    const canvas = owned ? document.createElement('canvas') : image;
    if (owned) {
      const bitmap = await createImageBitmap(image);
      const scale = Math.min(1, Math.sqrt(maxOcrPixels / (bitmap.width * bitmap.height)));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
    }
    try {
      const regions = readingRegions(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
      const texts = [];
      for (const [index, rectangle] of regions.entries()) {
        signal.throwIfAborted();
        if (regions.length > 1) progress(`${index === 0 ? '왼쪽' : '오른쪽'} 단 글자 읽는 중`);
        texts.push((await ocr.recognize(canvas, { rectangle })).data.text);
      }
      return texts.join('\n\n');
    } finally { if (owned) canvas.width = canvas.height = 0; }
  }
  return {
    async read(file, { raw = false } = {}) {
      signal.throwIfAborted();
      if (file.size > 20 * 1024 * 1024) throw new Error('파일당 20MB까지 지원합니다.');
      const kind = fileKind(file);
      if (kind === 'text') return (await file.text()).replace(/^\uFEFF/, '');
      if (kind === 'image') {
        const text = await recognize(file, raw);
        return raw ? text : listeningFromOcr(text);
      }
      const { getDocument, GlobalWorkerOptions, version } = await import('pdfjs-dist/build/pdf.mjs');
      const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      GlobalWorkerOptions.workerSrc = workerUrl;
      const cdn = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/`;
      const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
        cMapUrl: `${cdn}cmaps/`, cMapPacked: true, standardFontDataUrl: `${cdn}standard_fonts/`, wasmUrl: `${cdn}wasm/` });
      pdf = task;
      try {
        const pdfDocument = await task.promise;
        if (pdfDocument.numPages > 100) throw new Error('PDF는 파일당 100쪽까지 지원합니다.');
        const pages = [];
        let scanned = false;
        for (let n = 1; n <= pdfDocument.numPages; n++) {
          signal.throwIfAborted();
          progress(`PDF ${n}/${pdfDocument.numPages}쪽 읽는 중`);
          const page = await pdfDocument.getPage(n);
          let text = textFromPdfItems((await page.getTextContent()).items);
          if (text.replace(/\s/g, '').length < 30) {
            scanned = true;
            const initial = page.getViewport({ scale: 1 });
            const scale = Math.min(3, Math.sqrt(maxOcrPixels / (initial.width * initial.height)));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            try {
              await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
              text = await recognize(canvas, raw);
            } finally { canvas.width = canvas.height = 0; }
          }
          pages.push(text); page.cleanup();
        }
        const text = pages.join('\n\n');
        return scanned && !raw ? listeningFromOcr(text) : text;
      } finally {
        await task.destroy(); pdf = undefined;
      }
    },
    async close() {
      signal.removeEventListener('abort', abort);
      if (ocr) await ocr.terminate().catch(() => {});
    },
  };
}
