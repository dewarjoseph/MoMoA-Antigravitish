import { researchLogTool } from '../dist/src/tools/implementations/researchLogTool.js';
import * as assert from 'node:assert';

async function run() {
    process.stdout.write("Starting Research Pruning test...\n");
    let generatedCount = 0;
    
    // Mock GeminiClient
    const mockGemini = {
        sendOneShotMessage: async (prompt, opts) => {
            generatedCount++;
            return {
                candidates: [{
                    content: {
                        parts: [{ text: "Mocked Summary: Pruned 200+ lines successfully." }]
                    }
                }]
            };
        }
    };

    // Mock HiveMind
    let writtenToHive = false;
    const mockHiveMind = {
        writeGoldStandard: async (context, action, outcome, tags) => {
            writtenToHive = true;
            assert.strictEqual(context, 'Automated Research Log Pruning');
            return "mock-uuid";
        }
    };

    // Create a 201 line file
    const oldLines = Array.from({length: 201}, (_, i) => `Line ${i}`).join('\n');
    let savedContent = "";
    const files = new Map();
    files.set("RESEARCH_LOG.md", oldLines);

    // Mock Context
    const mockContext = {
        fileMap: files,
        editedFilesSet: new Set(),
        sendMessage: (msg) => {},
        multiAgentGeminiClient: mockGemini,
        hiveMind: mockHiveMind,
        saveFiles: false,
    };

    const res = await researchLogTool.execute({ entry: 'New log entry' }, mockContext);
    
    const newContent = files.get("RESEARCH_LOG.md");
    const newLines = newContent.split('\n');

    assert.ok(writtenToHive, "HiveMind write Gold Standard not called.");
    assert.strictEqual(generatedCount, 1, "Gemini should be called to summarize.");
    assert.ok(newLines.length < 200, "Log should be pruned. Found: " + newLines.length);
    assert.ok(newContent.includes('Mocked Summary'), "Summary should be prepended.");
    
    process.stdout.write("Test Passed!\n");
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
