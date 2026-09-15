// tailwindcss-preset-email ships no type declarations and no @types package exists for it
// (`main: src/index.js`, a plain CommonJS `module.exports = {...}`). Without this ambient
// declaration, `import tailwindcssPresetEmail from 'tailwindcss-preset-email'` fails
// TS7016 under `strict`. See src/emails/components/immich.layout.tsx and futo.layout.tsx,
// which need a real ESM import here (not `require(...)`) because the server runs under
// `"type": "module"`, where `require` is not a defined global.
declare module 'tailwindcss-preset-email';
