declare module "heic2any" {
  interface Options {
    blob: Blob;
    toType?: string;
    quality?: number;
    gifInterval?: number;
  }
  function heic2any(options: Options): Promise<Blob | Blob[]>;
  export default heic2any;
}
