import { scanLocalDirectory } from './dist/utils/localScanner.js';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const root = process.cwd();
  console.log('Scanning', root);
  try {
    const { fileMap, binaryFileMap } = await scanLocalDirectory(root);
    console.log('Text Files:', Array.from(fileMap.keys()).length);
    console.log('Binary Files:', Array.from(binaryFileMap.keys()).length);
  } catch (e) {
    console.error('CRASH:', e);
  }
}
main();
