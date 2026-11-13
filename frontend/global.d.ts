// Side-effect CSS imports (`import './globals.css'`) are handled by Next's bundler at build/dev
// time, but a standalone `tsc --noEmit` run needs an ambient module declaration to type-check them.
declare module '*.css';
