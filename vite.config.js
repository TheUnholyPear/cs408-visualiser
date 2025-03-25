import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
    root: 'app',
    base: '/cs408-visualiser/',
    build: {
        outDir: 'dist', // <- this will go to app/dist
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'app/index.html'),
            },
        },
    },
})

