# Vendored code

- `qrcode-generator.js` is `dist/qrcode.mjs` from the npm package
  `qrcode-generator@2.0.4` by Kazuhiko Arase, copied unmodified (MIT license,
  header retained in the file). It is vendored instead of installed so that
  package-lock.json stays untouched. ESLint ignores this folder.
- `qr.js` is our thin wrapper (UTF-8 byte encoding + matrix helper).
