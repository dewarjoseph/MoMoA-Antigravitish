import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('momo.openWebview', () => {
        const panel = vscode.window.createWebviewPanel(
            'momoWebview',
            'MoMo Overseer UI',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'web'))]
            }
        );

        // Serve the built Vite react app
        const webPath = path.join(context.extensionPath, 'web');
        let htmlPath = path.join(webPath, 'index.html');
        let html = '';
        if (fs.existsSync(htmlPath)) {
            html = fs.readFileSync(htmlPath, 'utf8');
            // Basic regex to rewrite asset links to vscode-resource relative URIs
            html = html.replace(/(href|src)="\/([^"]*)"/g, (match, p1, p2) => {
                const assetUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(webPath, p2)));
                return \`\${p1}="\${assetUri}"\`;
            });
        } else {
            html = `<html><body><h1>MoMo UI build not found.</h1><p>Please run the build script.</p></body></html>`;
        }

        panel.webview.html = html;
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}
