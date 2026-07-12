declare module "pdf-parse" {
  function pdfParse(dataBuffer: Buffer): Promise<{ text: string; numpages?: number }>;
  export default pdfParse;
}
