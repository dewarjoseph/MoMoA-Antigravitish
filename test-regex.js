const { RegexValidatorTool } = require('./dist/tools/implementations/regexValidatorTool.js');
const tool = new RegexValidatorTool();
tool.execute({ regExString: '{SoRegEx}^[a-z]+${EoRegEx}', flags: '', testCases: [{ input: 'hello', expected: true, type: 'validate' }] }, { multiAgentGeminiClient: { sendOneShotMessage: async () => ({ text: 'explanation' }) } })
  .then(res => console.log("Result:", res))
  .catch(err => console.error("Error:", err));
