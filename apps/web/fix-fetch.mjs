import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'src/features/lumina/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

for (const file of files) {
  const filepath = path.join(dir, file);
  let content = fs.readFileSync(filepath, 'utf8');
  
  if (!content.includes('fetch(') || file === 'webSearch.ts' || file === 'getWeather.ts') {
    continue;
  }
  
  if (!content.includes('import { request }')) {
    content = content.replace(
      'import type { LuminaTool', 
      'import { request } from "../../../lib/api.js";\nimport type { LuminaTool'
    );
  }

  // Very naive replace, let's just do it file by file manually to avoid destroying the tools.
}
