import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      // Every dependency graph reached only through the lazily loaded
      // document viewers. Pre-bundling them at dev-server start keeps the
      // optimizer from re-bundling mid-session the first time a viewer
      // opens — a mid-session re-bundle swaps the pre-bundled React copy
      // under already-loaded chunks, which then crash with "Cannot read
      // properties of null (reading 'useState')".
      include: [
        'react-markdown',
        'unified',
        'unist-util-visit',
        'github-slugger',
        'remark-parse',
        'remark-gfm',
        'remark-math',
        'remark-frontmatter',
        'remark-deflist',
        'remark-smartypants',
        'rehype-highlight',
        'rehype-katex',
        'rehype-raw',
        'rehype-sanitize',
        'katex',
        'mermaid',
        'smol-toml',
        'yaml',
        'pdfjs-dist',
        'pdf-lib',
        'pptx-vanilla-viewer',
        'react-resizable-panels',
        'lucide-react',
        '@codemirror/lang-html',
        '@codemirror/lang-markdown',
        '@codemirror/language-data',
        '@codemirror/theme-one-dark',
        '@codemirror/view',
        '@eigenpal/docx-editor-react',
        '@eigenpal/docx-editor-react/plugin-api',
        '@univerjs/core',
        '@univerjs/core/lib/facade',
        '@univerjs/preset-sheets-conditional-formatting',
        '@univerjs/preset-sheets-conditional-formatting/locales/en-US',
        '@univerjs/preset-sheets-core',
        '@univerjs/preset-sheets-core/locales/en-US',
        '@univerjs/preset-sheets-data-validation',
        '@univerjs/preset-sheets-data-validation/locales/en-US',
        '@univerjs/preset-sheets-filter',
        '@univerjs/preset-sheets-filter/locales/en-US',
        '@univerjs/preset-sheets-find-replace',
        '@univerjs/preset-sheets-find-replace/locales/en-US',
        '@univerjs/preset-sheets-hyper-link',
        '@univerjs/preset-sheets-hyper-link/locales/en-US',
        '@univerjs/preset-sheets-sort',
        '@univerjs/preset-sheets-sort/locales/en-US'
      ]
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          export: resolve('src/renderer/export.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
