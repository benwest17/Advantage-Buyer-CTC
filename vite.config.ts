GitHub upload instructions for Advantage-Buyer-CTC

The app must have this structure in GitHub:

index.html
package.json
postcss.config.js
tailwind.config.js
tsconfig.json
vite.config.ts
src/
  App.tsx
  index.css
  main.tsx

Important:
Do not upload the files inside the src folder directly to the repo root.
The src folder itself must be present in GitHub.

If GitHub currently shows main.tsx and index.css at the repo root, that is okay temporarily,
but Vercel will not build until src/App.tsx, src/main.tsx, and src/index.css exist.

Best upload path:
1. Extract the zip.
2. Open the extracted folder.
3. Drag the src folder itself into GitHub, plus the root files if needed.
4. Commit the upload to main.
5. Vercel should rebuild automatically.
