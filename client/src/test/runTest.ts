import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // The path to the workspace file for testing
    const testWorkspace = path.resolve(__dirname, '../../../test');

    // Download VS Code, unzip it and run the integration test
    await runTests({ 
      extensionDevelopmentPath, 
      extensionTestsPath,
      launchArgs: [testWorkspace, '--disable-extensions']
    });
  } catch (_err) {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

void main();