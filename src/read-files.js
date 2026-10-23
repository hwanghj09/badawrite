import { textFromPdfItems } from './pdf-text.js';

export function fileKind(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) return 'text';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)) return 'image';
  throw new Error('PDF, JPG, PNG, WEBP, TXT 파일만 지원합니다.');
}

export function createFileReader(signal, progress) {
  let ocr;
  let pdf;
  const abort = () => {
    void ocr?.terminate().catch(() => {});
    void pdf?.destroy().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  async function recognize(image) {
    signal.throwIfAborted();
    if (!ocr) {
      progress('글자 인식 모델 준비 중');
      const { createWorker } = await import('tesseract.js');
      ocr = await createWorker('eng+kor', 1, {
        logger: p => { if (p.status === 'recognizing text') progress(`글자 인식 ${Math.round(p.progress * 100)}%`); },
      });
    }
    signal.throwIfAborted();
    return (await ocr.recognize(image)).data.text;
  }
  return {
    async read(file) {
      signal.throwIfAborted();
      if (file.size > 20 * 1024 * 1024) throw new Error('파일당 20MB까지 지원합니다.');
      const kind = fileKind(file);
      if (kind === 'text') return (await file.text()).replace(/^\uFEFF/, '');
      if (kind === 'image') return recognize(file);
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
        for (let n = 1; n <= pdfDocument.numPages; n++) {
          signal.throwIfAborted();
          progress(`PDF ${n}/${pdfDocument.numPages}쪽 읽는 중`);
          const page = await pdfDocument.getPage(n);
          let text = textFromPdfItems((await page.getTextContent()).items);
          if (text.replace(/\s/g, '').length < 30) {
            const initial = page.getViewport({ scale: 1 });
            const scale = Math.min(2, Math.sqrt(6000000 / (initial.width * initial.height)));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            text = await recognize(canvas);
            canvas.width = canvas.height = 0;
          }
          pages.push(text); page.cleanup();
        }
        return pages.join('\n\n');
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
