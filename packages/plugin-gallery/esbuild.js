const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  sourcemap: false,
  minify: false,
  format: 'cjs', // needs to be CJS for now
  target: ['es2020'], // don't go over es2020 because quickjs doesn't support it
});
