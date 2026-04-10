import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import FormData from 'form-data';

interface ScalarInfo {
    name: string;
    association: 'point' | 'cell';
    min: number;
    max: number;
}

interface Stats {
    points: number;
    cells: number;
    bounds: number[];
}

interface ConvertResult {
    status: 'ready' | 'pending_conversion' | 'error';
    file_id?: string;
    original_name?: string;
    message?: string;
    scalars?: ScalarInfo[];
    stats?: Stats;
}

export class SimulationViewerPanel implements vscode.CustomReadonlyEditorProvider {
    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getPort: () => number | undefined
    ) {}

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => undefined };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media')
            ]
        };

        const htmlPath = path.join(
            this.context.extensionPath,
            'dist',
            'media',
            'viewer.html'
        );

        if (!fs.existsSync(htmlPath)) {
            webviewPanel.webview.html = this.getErrorHtml(
                'viewer.html not found in dist/media. Please run: npm run compile'
            );
            return;
        }

        const vtkJsUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'media', 'vtk.js')
        );
        webviewPanel.webview.html = fs
            .readFileSync(htmlPath, 'utf8')
            .replace('__VTK_JS_URI__', vtkJsUri.toString());

        webviewPanel.webview.onDidReceiveMessage(async (msg: { type: string; dataUrl?: string; message?: string }) => {
            switch (msg.type) {
                case 'ready':
                    await this.uploadFile(document.uri, webviewPanel.webview);
                    break;

                case 'screenshot':
                    if (msg.dataUrl) {
                        await this.saveScreenshot(document.uri, msg.dataUrl);
                    }
                    break;

                case 'error':
                    vscode.window.showErrorMessage(
                        `Simulation Viewer error: ${msg.message ?? 'Unknown error'}`
                    );
                    break;
            }
        });
    }

    private async uploadFile(uri: vscode.Uri, webview: vscode.Webview): Promise<void> {
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
        webview.postMessage({ type: 'error', message: `File not found: ${filePath}` });
        return;
    }

    // Wait for backend to be ready (max 30 seconds)
    let port = this.getPort();
    if (!port) {
        webview.postMessage({ type: 'progress', percent: 5, message: 'Waiting for backend to start...' });
        
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            port = this.getPort();
            if (port) break;
            webview.postMessage({ type: 'progress', percent: 5, message: `Waiting for backend... (${i + 1}s)` });
        }
    }

    if (!port) {
        webview.postMessage({ type: 'error', message: 'Backend failed to start. Check Output log: Simulation Viewer.' });
        return;
    }

    const fileId = crypto.randomBytes(16).toString('hex');
    webview.postMessage({ type: 'progress', percent: 10, message: 'Uploading file...' });

    try {
        const result = await this.postFile(port, filePath, fileName, fileId, (percent, message) => {
            webview.postMessage({ type: 'progress', percent, message });
        });

        if (result.status === 'ready') {
            webview.postMessage({
                type: 'fileReady',
                fileId: result.file_id,
                fileName,
                datasetUrl: `http://127.0.0.1:${port}/dataset/${result.file_id}`,
                scalars: result.scalars ?? [],
                stats: result.stats
            });
        } else if (result.status === 'pending_conversion') {
            webview.postMessage({ type: 'pending', fileName, message: result.message ?? '' });
        } else {
            webview.postMessage({ type: 'error', message: result.message ?? 'Conversion failed' });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        webview.postMessage({ type: 'error', message });
    }
}

    private postFile(
        port: number,
        filePath: string,
        fileName: string,
        fileId: string,
        onProgress: (percent: number, message: string) => void
    ): Promise<ConvertResult> {
        return new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('file', fs.createReadStream(filePath), { filename: fileName });

            const options: http.RequestOptions = {
                hostname: '127.0.0.1',
                port,
                path: '/convert',
                method: 'POST',
                headers: {
                    ...form.getHeaders(),
                    'x-file-id': fileId
                }
            };

            onProgress(10, 'Sending file to backend...');

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk: Buffer) => (body += chunk.toString()));
                res.on('end', () => {
                    try {
                        const parsed: ConvertResult = JSON.parse(body);
                        resolve(parsed);
                    } catch {
                        reject(new Error('Failed to parse backend response'));
                    }
                });
            });

            req.on('error', (err) => reject(err));
            form.pipe(req);
        });
    }

    private async saveScreenshot(uri: vscode.Uri, dataUrl: string): Promise<void> {
        const base64 = dataUrl.split(',')[1];
        if (!base64) { return; }

        const buffer = Buffer.from(base64, 'base64');
        const screenshotPath = uri.fsPath.replace(/\.[^.]+$/, '_screenshot.png');
        const screenshotUri = vscode.Uri.file(screenshotPath);

        await vscode.workspace.fs.writeFile(screenshotUri, buffer);
        vscode.window.showInformationMessage(`Screenshot saved: ${screenshotPath}`);
    }

    private getErrorHtml(message: string): string {
        return `<!DOCTYPE html><html><body style="background:#1e1e1e;color:#f44;font-family:monospace;padding:20px;">
            <h3>Simulation Viewer Error</h3><p>${message}</p></body></html>`;
    }
}
