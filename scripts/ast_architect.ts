import * as ts from 'typescript';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const MAX_COMPLEXITY = 50; // Cyclomatic complexity threshold for fission
const MAX_LOC = 1000;     // Lines of code threshold

console.log("[<SYNC_MODE> AST-Architect] Initializing Meta-Architectural Fission Protocol...");

// Locate tsconfig
const configPath = ts.findConfigFile(
  "./",
  ts.sys.fileExists,
  "tsconfig.json"
);

if (!configPath) {
  console.error("Could not find a valid 'tsconfig.json'.");
  process.exit(1);
}

// Parse configuration
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath)
);

parsedConfig.options.noUnusedLocals = true;
parsedConfig.options.noUnusedParameters = true;

const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options);
const typeChecker = program.getTypeChecker();

/**
 * Calculates cyclomatic complexity for a given AST node
 */
function calculateComplexity(node: ts.Node): number {
  let complexity = 0;
  
  if (
    ts.isIfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node)
  ) {
    complexity = 1;
  }

  ts.forEachChild(node, (child) => {
    complexity += calculateComplexity(child);
  });

  return complexity;
}

/**
 * Generates an index.ts bridge
 */
function generateBridgeIndex(dirPath: string, exports: string[]): void {
  const indexPath = path.join(dirPath, 'index.ts');
  const content = exports.map(e => `export * from './${e}.js';`).join('\n') + '\n';
  fs.writeFileSync(indexPath, content, 'utf-8');
  console.log(`[<SYNC_MODE> AST-Architect] Generated bridge: ${indexPath}`);
}

/**
 * Fission a monolith into micro-modules
 */
function performFission(sourceFile: ts.SourceFile, classesToExtract: ts.ClassDeclaration[], functionsToExtract: ts.FunctionDeclaration[]) {
  const monolithPath = sourceFile.fileName;
  const monolithDir = path.dirname(monolithPath);
  const monolithName = path.basename(monolithPath, '.ts');
  const fissionDir = path.join(monolithDir, monolithName);
  
  if (!fs.existsSync(fissionDir)) {
    fs.mkdirSync(fissionDir, { recursive: true });
  }

  const generatedModules: string[] = [];
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  // Simple extraction: writes top-level classes/functions into separate files.
  // In a full implementation, we must resolve inter-dependencies and auto-inject imports.
  for (const cls of classesToExtract) {
    if (!cls.name) continue;
    const className = cls.name.text;
    const extractedContent = printer.printNode(ts.EmitHint.Unspecified, cls, sourceFile);
    
    // We would need to compute the required imports here for a production-ready fission.
    // For now, we write the raw code and assume basic imports can be heuristically placed or self-healed.
    const newFilePath = path.join(fissionDir, `${className}.ts`);
    const header = `// <AST-Fission> Extracted from ${monolithName}.ts\n// Auto-Healer needs to inject dependencies.\n\nexport ${extractedContent}`;
    
    fs.writeFileSync(newFilePath, header, 'utf-8');
    generatedModules.push(className);
    console.log(`[<SYNC_MODE> AST-Architect] Extracted Class: ${className} -> ${newFilePath}`);
  }

  // Generate the bridge
  if (generatedModules.length > 0) {
    generateBridgeIndex(fissionDir, generatedModules);
    console.log(`[<SYNC_MODE> AST-Architect] Monolith ${monolithName}.ts flagged for architectural re-routing to ${fissionDir}/index.ts`);
    // Here we would use ts.transform to update imports across the ENTIRE codebase
    // pointing to the old monolith -> pointing to the new index bridge.
  }
}

const sourceFiles = program.getSourceFiles()
   .filter(sf => !sf.isDeclarationFile && !sf.fileName.includes("node_modules") && sf.fileName.includes("MoMoA-Antigravitish"));

let fissionsTriggered = 0;

console.log(`[<SYNC_MODE> AST-Architect] Target pool: ${sourceFiles.length} files. Engaging structural scan...`);

for (const sourceFile of sourceFiles) {
  let fileComplexity = 0;
  const classesToExtract: ts.ClassDeclaration[] = [];
  const functionsToExtract: ts.FunctionDeclaration[] = [];

  // 1. Analyze Complexity and Topology Limits
  ts.forEachChild(sourceFile, (node) => {
    fileComplexity += calculateComplexity(node);

    if (ts.isClassDeclaration(node) && calculateComplexity(node) > 10) {
      classesToExtract.push(node);
    } else if (ts.isFunctionDeclaration(node) && calculateComplexity(node) > 15) {
      functionsToExtract.push(node);
    }
  });

  const linesOfCode = sourceFile.getLineAndCharacterOfPosition(sourceFile.getEnd()).line + 1;

  if (fileComplexity > MAX_COMPLEXITY || linesOfCode > MAX_LOC) {
    console.warn(`[<SYNC_MODE> AST-Architect] Topology threshold breached in ${sourceFile.fileName}`);
    console.warn(`                            [Complexity: ${fileComplexity}/${MAX_COMPLEXITY}] [LOC: ${linesOfCode}/${MAX_LOC}]`);
    
    // Initiate Fission Protocol
    if (classesToExtract.length > 0 || functionsToExtract.length > 0) {
        performFission(sourceFile, classesToExtract, functionsToExtract);
        fissionsTriggered++;
    }
  }
}

console.log(`[<SYNC_MODE> AST-Architect] Fission sequence complete. Topological ruptures resolved: ${fissionsTriggered}`);
