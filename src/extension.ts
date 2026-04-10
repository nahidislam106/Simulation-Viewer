
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SimulationViewerPanel } from './SimulationViewerPanel';

let backendProcess: cp.ChildProcess | undefined;
let backendPort: number | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Simulation Viewer');
    context.subscriptions.push(outputChannel);

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(sync~spin) Simulation Viewer: Starting...';
    statusBarItem.tooltip = 'Click to show Simulation Viewer log';
    statusBarItem.command = 'simulationViewer.showLog';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('simulationViewer.showLog', () => {
            outputChannel.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('simulationViewer.openFile', async () => {
            const activeUri = vscode.window.activeTextEditor?.document.uri;
            let targetUri: vscode.Uri | undefined;
            if (activeUri) {
                const ext = path.extname(activeUri.fsPath).toLowerCase();
                if (['.vtk', '.vtu', '.vtp', '.mph'].includes(ext)) {
                    targetUri = activeUri;
                }
            }
            if (!targetUri) {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { 'Simulation Files': ['vtk', 'vtu', 'vtp', 'mph'] },
                    title: 'Open Simulation File'
                });
                targetUri = picked?.[0];
            }
            if (targetUri) {
                await vscode.commands.executeCommand('vscode.openWith', targetUri, 'simulationViewer.viewer');
            }
        })
    );

    const config = vscode.workspace.getConfiguration('simulationViewer');
    if (config.get<boolean>('autoStartBackend', true)) {
        await startBackend(context);
    } else {
        statusBarItem.text = '$(eye) Simulation Viewer: Manual start';
    }

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            'simulationViewer.viewer',
            new SimulationViewerPanel(context, () => backendPort),
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: { retainContextWhenHidden: true }
            }
        )
    );
}

function getVenvPython(context: vscode.ExtensionContext): string {
    const venvPath = path.join(context.globalStoragePath, 'simviewer-venv');
    if (process.platform === 'win32') {
        return path.join(venvPath, 'Scripts', 'python.exe');
    }
    return path.join(venvPath, 'bin', 'python');
}

function venvExists(context: vscode.ExtensionContext): boolean {
    return fs.existsSync(getVenvPython(context));
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const proc = cp.spawn(command, args, { shell: true });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
        proc.on('error', () => resolve({ code: 1, stdout, stderr }));
    });
}

function resolveConfiguredPython(configuredPath: string): string {
    if (configuredPath.startsWith('~/')) {
        return path.join(os.homedir(), configuredPath.slice(2));
    }
    return configuredPath;
}

async function isUsablePython(python: string): Promise<boolean> {
    if (!python.trim()) {
        return false;
    }
    const result = await runCommand(python, ['--version']);
    return result.code === 0;
}

async function findSystemPython(): Promise<string | null> {
    const candidates = ['python3', 'python', 'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3.8'];
    for (const candidate of candidates) {
        const result = await runCommand(candidate, ['--version']);
        if (result.code === 0) {
            outputChannel.appendLine(`[Extension] Found Python: ${candidate} → ${result.stdout.trim()}`);
            return candidate;
        }
    }
    return null;
}

async function setupVenv(context: vscode.ExtensionContext, systemPython: string): Promise<boolean> {
    const venvPath = path.join(context.globalStoragePath, 'simviewer-venv');
    const reqPath = path.join(context.extensionPath, 'backend', 'requirements.txt');

    fs.mkdirSync(context.globalStoragePath, { recursive: true });

    outputChannel.appendLine(`[Setup] Creating venv at: ${venvPath}`);
    statusBarItem.text = '$(sync~spin) Simulation Viewer: Creating environment...';

    const createResult = await runCommand(systemPython, ['-m', 'venv', venvPath]);
    if (createResult.code !== 0) {
        outputChannel.appendLine(`[Setup] venv creation failed: ${createResult.stderr}`);
        return false;
    }

    outputChannel.appendLine('[Setup] Installing Python packages (this may take a minute)...');
    statusBarItem.text = '$(sync~spin) Simulation Viewer: Installing packages...';

    const venvPip = process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'pip')
        : path.join(venvPath, 'bin', 'pip');

    const installResult = await runCommand(venvPip, ['install', '-r', reqPath, '--quiet']);
    if (installResult.code !== 0) {
        outputChannel.appendLine(`[Setup] Install failed: ${installResult.stderr}`);
        return false;
    }

    outputChannel.appendLine('[Setup] All packages installed successfully.');
    return true;
}

async function startBackend(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('simulationViewer');
    const configuredPythonRaw = config.get<string>('pythonPath', '').trim();
    const configuredPython = resolveConfiguredPython(configuredPythonRaw);

    let python = '';

    if (configuredPython) {
        const configuredUsable = await isUsablePython(configuredPython);
        if (configuredUsable) {
            outputChannel.appendLine(`[Extension] Using configured Python: ${configuredPython}`);
            python = configuredPython;
        } else {
            outputChannel.appendLine(
                `[Extension] Configured Python is invalid or unavailable: ${configuredPythonRaw}`
            );
            void vscode.window.showWarningMessage(
                'Simulation Viewer: Configured Python path is invalid. Falling back to auto-detected environment.',
                'Open Settings'
            ).then((action) => {
                if (action === 'Open Settings') {
                    void vscode.commands.executeCommand('workbench.action.openSettings', 'simulationViewer.pythonPath');
                }
            });
        }
    }

    if (!python && venvExists(context)) {
        python = getVenvPython(context);
        outputChannel.appendLine(`[Extension] Using existing venv: ${python}`);
    }

    if (!python) {
        statusBarItem.text = '$(sync~spin) Simulation Viewer: Looking for Python...';
        const systemPython = await findSystemPython();

        if (!systemPython) {
            statusBarItem.text = '$(error) Simulation Viewer: Python not found';
            const action = await vscode.window.showErrorMessage(
                'Simulation Viewer: Python 3.8+ is required but was not found.',
                'Download Python',
                'Set Python Path'
            );
            if (action === 'Download Python') {
                await vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
            } else if (action === 'Set Python Path') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'simulationViewer.pythonPath');
            }
            return;
        }

        let setupOk = false;
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Simulation Viewer: Setting up Python environment (first time only)...',
                cancellable: false
            },
            async (progress) => {
                progress.report({ message: 'Creating virtual environment...' });
                setupOk = await setupVenv(context, systemPython);
                if (setupOk) {
                    progress.report({ message: 'Done!' });
                }
            }
        );

        if (!setupOk || !venvExists(context)) {
            statusBarItem.text = '$(error) Simulation Viewer: Setup failed';
            vscode.window.showErrorMessage(
                'Simulation Viewer: Failed to install Python packages. See Output log.',
                'Show Log'
            ).then(a => { if (a === 'Show Log') { outputChannel.show(); } });
            return;
        }

        python = getVenvPython(context);
    }

    const serverScript = path.join(context.extensionPath, 'backend', 'server.py');
    const workdir = path.join(context.globalStoragePath, 'workdir');
    fs.mkdirSync(workdir, { recursive: true });

    outputChannel.appendLine(`[Extension] Starting backend: ${python} ${serverScript}`);

    backendProcess = cp.spawn(python, [serverScript, '--port', '0', '--workdir', workdir], {
        cwd: path.join(context.extensionPath, 'backend'),
        env: { ...process.env }
    });

    backendProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        outputChannel.append(`[Backend] ${text}`);
        const match = text.match(/READY:(\d+)/);
        if (match) {
            backendPort = parseInt(match[1], 10);
            statusBarItem.text = `$(eye) Simulation Viewer: Ready`;
            statusBarItem.tooltip = `Backend on port ${backendPort} — click to show log`;
            outputChannel.appendLine(`[Extension] Backend ready on port ${backendPort}`);
        }
    });

    backendProcess.stderr?.on('data', (data: Buffer) => {
        outputChannel.append(`[Backend ERR] ${data.toString()}`);
    });

    backendProcess.on('exit', (code) => {
        outputChannel.appendLine(`[Extension] Backend exited: code ${code}`);
        statusBarItem.text = '$(error) Simulation Viewer: Backend stopped';
        backendPort = undefined;
    });

    backendProcess.on('error', (err) => {
        outputChannel.appendLine(`[Extension] Spawn error: ${err.message}`);
        statusBarItem.text = '$(error) Simulation Viewer: Start failed';
    });
}

export function deactivate(): void {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = undefined;
    }
}