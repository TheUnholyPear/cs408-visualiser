import { defineConfig } from 'vite'

export default defineConfig({
    root: 'app',
    base: '/cs408-visualiser/', // repo name goes here!
    build: {
        outDir: 'dist'
    }
})