import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export interface PdfPageImage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Render all pages of a PDF file to base64 Data URLs
 */
export async function renderPdfPagesToImages(
  fileOrBuffer: File | ArrayBuffer,
  scale = 2.0
): Promise<PdfPageImage[]> {
  try {
    let arrayBuffer: ArrayBuffer;
    if (fileOrBuffer instanceof File) {
      arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
      arrayBuffer = fileOrBuffer;
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pageImages: PdfPageImage[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      } as any).promise;

      const dataUrl = canvas.toDataURL("image/png");
      pageImages.push({
        pageNumber: i,
        dataUrl,
        width: viewport.width,
        height: viewport.height,
      });
    }

    return pageImages;
  } catch (err) {
    console.error("Failed rendering PDF file via pdf.js:", err);
    throw err;
  }
}
