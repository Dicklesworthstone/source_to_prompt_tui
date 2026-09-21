declare module "csso" {
  interface MinifyResult {
    css: string;
  }

  export function minify(source: string, options?: object): MinifyResult;
}

declare module "html-minifier-terser" {
  interface MinifyOptions {
    collapseWhitespace?: boolean;
    removeComments?: boolean;
    removeRedundantAttributes?: boolean;
    removeEmptyAttributes?: boolean;
    minifyCSS?: boolean;
    minifyJS?: boolean;
  }

  export function minify(html: string, options?: MinifyOptions): Promise<string>;
}

declare module "ink-syntax-highlight" {
  import { FC } from "react";

  interface SyntaxHighlightProps {
    language?: string;
    code: string;
  }

  const SyntaxHighlight: FC<SyntaxHighlightProps>;
  export default SyntaxHighlight;
}
