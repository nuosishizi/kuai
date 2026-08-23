import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiDir = __dirname;
const targetHtml = path.join(uiDir, '..', 'ui.html');

export function buildUiHtml() {
  const head = fs.readFileSync(path.join(uiDir, 'html/00-head.html'), 'utf8');
  const tail = fs.readFileSync(path.join(uiDir, 'html/99-tail.html'), 'utf8');

  // Combine CSS files in alphabetical order
  const styleFiles = fs.readdirSync(path.join(uiDir, 'styles'))
    .filter(f => f.endsWith('.css'))
    .sort();
  const combinedCss = styleFiles
    .map(f => fs.readFileSync(path.join(uiDir, 'styles', f), 'utf8'))
    .join('');

  // Combine HTML body files in alphabetical order
  const htmlFiles = fs.readdirSync(path.join(uiDir, 'html'))
    .filter(f => f.endsWith('.html') && f !== '00-head.html' && f !== '99-tail.html')
    .sort();
  const combinedBody = htmlFiles
    .map(f => fs.readFileSync(path.join(uiDir, 'html', f), 'utf8'))
    .join('');

  // Combine JS scripts in alphabetical order
  const scriptFiles = fs.readdirSync(path.join(uiDir, 'scripts'))
    .filter(f => f.endsWith('.js'))
    .sort();
  const combinedJs = scriptFiles
    .map(f => fs.readFileSync(path.join(uiDir, 'scripts', f), 'utf8'))
    .join('');

  const fullHtml = `${head}${combinedCss}${combinedBody}${combinedJs}${tail}`;

  fs.writeFileSync(targetHtml, fullHtml, 'utf8');
  console.log(`[UI Builder] Successfully generated ui.html (${fullHtml.length} bytes)`);
  return fullHtml;
}

if (process.argv[1] === __filename) {
  buildUiHtml();
}
