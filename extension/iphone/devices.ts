
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Cancelable } from './cancelable';
import { promisify } from 'util';
import { ChildProcess, spawn } from 'child_process';
import { resolve } from 'url';

/**
 * So `devices` needs to get `OutputChannel` and `ExtensionContext.extensionUri`
 */
 let output: vscode.OutputChannel = null;
 export function setOutput(output_: vscode.OutputChannel) {
     output = output_;
 }

const execFile = promisify(require('child_process').execFile);

function iosDeployBinPathInDev() {
    const iosDeployPackagePath = require.resolve('ios-deploy/package.json'); // node_modules/ios-deploy/package.json
    const binRelativePath = 'build/Release/ios-deploy';
    const iosDeployPath = path.join(path.dirname(iosDeployPackagePath), binRelativePath);
    return iosDeployPath;
}

function iosDeployBinPathInProd() {
    const extensionInstallPath = vscode.extensions.getExtension('kenny.lightcodeios').extensionUri.fsPath;
    const iosDeployPath = path.join(extensionInstallPath, 'node_modules/ios-deploy/build/Release/ios-deploy');
    return iosDeployPath;
}

// Get the abs path of ios-deploy
function IOS_DEPLOY() {
    // Dev
    const devPath = iosDeployBinPathInDev();
    // output.appendLine(`ios-deploy devpath = ${devPath}`);
    if (fs.existsSync(devPath)) {
        return devPath;
    }

    // Prod
    const prodPath = iosDeployBinPathInProd();
    // output.appendLine(`ios-deploy path = ${prodPath}`);
    if (fs.existsSync(prodPath)) {
        return prodPath;
    } else {
        // output.appendLine(`Error: ios-deploy not found`);
        return null;
    }
}

export enum TaskStatus {
    SUCCESS,
    FAIL,
    CANCELLED
}

export enum DebugServerStatus {
    SUCCESS,
    FAIL_PHONE_LOCKED,
    FAIL
}

export type DebugServerResult = {
    // status of starting a debugserver
    status: DebugServerStatus,
    // When succeed, the port on which a debugserver is running.
    port: number
};

export interface Target {
    udid: string,
    name: string,
    version: string,
    buildVersion: string,
    runtime: string,
    sdk: string,
    modelName: string
};

/**
 *
 * @returns [an array of targets, success]
 */
export async function getConnectedDevices(): Promise<[Target[], boolean]>
{
    // output.appendLine(`Listing devices using ${IOS_DEPLOY()}`);

    try {
        const {stdout, stderr} = await execFile(IOS_DEPLOY(), ['--detect', '--timeout', '1', '--json']);
        if (stderr) {
            output.appendLine(`stderr: ${stderr}`);
            return null;
        }
        const stdoutJsonStr = `[${stdout.replace(/\n\}\{\n/g, '\n},{\n')}]`;
        const devices: Target[] = JSON.parse(stdoutJsonStr) || {};
        const validDevices = devices
                .filter((d: any) => d.Event === 'DeviceDetected')
                .map((d: any) => d.Device)
                .filter((d: any) => d.DeviceClass === 'iPhone')
                .map((d: any): Target => ({
                    udid: d.DeviceIdentifier as string,
                    name: d.DeviceName,
                    version: d.ProductVersion,
                    buildVersion: d.BuildVersion,
                    runtime: `iOS ${d.ProductVersion}`,
                    sdk: "iphoneos",
                    modelName: d.modelName,
                }));


        return [validDevices, true];

    } catch (error) {
        output.appendLine(`Error when listing connected devices: ${JSON.stringify(error)}`);
        return [[], false];
    }
}

/**
 * Problem 1: When using incremental install, if the app is already installed, there is no path returned to me.
 *  - I should get the bundleID and attach.
 * "a process is already being debugged" requires some cleanup, if i can get a repro step.
 *
 * @param progressCallback to pass events for upper layers to parse and report progress.
 */
export async function installToDevice(udid: string, pathOnMac: string, progressCallback: (event:any)=>void, cancelable: Cancelable): Promise<[string|null, boolean]>
{
    const pathOnDevicePromise:Promise<[string|null, boolean]> = new Promise((resolve, reject) => {
        let pathOnDevice: string|null = null;
        let errorDidHappen = false;
        const childProcess = spawn(IOS_DEPLOY(), ['--id', udid, '--faster-path-search', '--timeout', '3', '--bundle', pathOnMac, '--app_deltas', '/tmp/', '--json']);
        childProcess.stdout.setEncoding('utf8');
        childProcess.stdout.on('data', (data) => {
            // check for cancel
            if (cancelable.isCanceled()) {
                childProcess.kill();
                resolve([null, true]);
                return;
            }

            // parse the data
            let event = null;
            try {
                event = JSON.parse(data.toString());
            } catch (error) {
                // no-op
            }
            if (event) {
                progressCallback(event);
                if (event.Path && event.Path.length > 0) {
                    pathOnDevice = event.Path;
                }
            }
        });
        childProcess.stdout.on('error', (data) => {
            errorDidHappen = true;
            resolve([null, false]);
        });
        childProcess.stderr.on('data', (data) => {
            let event = JSON.parse(data.toString());
            output.appendLine(event);
        });
        childProcess.stderr.on('error', (data) => {
            errorDidHappen = true;
            resolve([null, false]);
        });
        childProcess.on('error', (e) => {
            output.appendLine(JSON.stringify(e));
            errorDidHappen = true;
            resolve([null, false]);
        });
        childProcess.on('message', (msg) => {
            output.appendLine(msg);
        });
        childProcess.on('close', (data:any) => {
            resolve([pathOnDevice, errorDidHappen]);
        });
    });

    const [pathOnDevice, errorDidHappen] = await pathOnDevicePromise;

    if (errorDidHappen) {
        return [null, false];
    } else {
        return [pathOnDevice, true];
    }
}

/**
 * Heuristics for build success: right before close, the last output isn't from error.
 */
export async function runBuildCommand(buildCommand: string, cwd: string, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<TaskStatus> {
    output.appendLine(`Running build command: ${buildCommand}`);

    return new Promise((resolve, reject) => {
        let lastestMessageIsError = false;
        // Example: xcodebuild -configuration Debug -sdk iphoneos -allowProvisioningUpdates
        let childProcess = spawn(buildCommand, [], {cwd: cwd, shell: true});
        childProcess.stdout.setEncoding('utf8');
        childProcess.stderr.setEncoding('utf8');

        // When build is canceled, kill this child process.
        token.onCancellationRequested(() => {
            childProcess.kill();
            output.appendLine("Build has been cancelled");
            resolve(TaskStatus.CANCELLED);
        });

        childProcess.on('error', (e) => {
            output.appendLine(JSON.stringify(e));
            resolve(TaskStatus.FAIL);
        });

        childProcess.on('close', (code, signal) => {
            if (lastestMessageIsError) {
                resolve(TaskStatus.FAIL);
            } else {
                resolve(TaskStatus.SUCCESS);
            }
        });

        childProcess.stdout.on('data', (str:string) => {
            lastestMessageIsError = _outputMayIndicateError(str);
            output.appendLine(`${str}`);
            progress.report({
                message: `${ str }`,
            });
        });

        // The "BUILD FAILED" error shows up here, so this could indicate failures.
        // But also "Starting new Buck daemon". So here we shouldn't always resolve().
        // So this is really just a kind of std output. Can't rely on it to detect fatals.
        childProcess.stderr.on('data', (str:string) => {
            lastestMessageIsError = _outputMayIndicateError(str);
            output.appendLine(`${str}`);
        });
    });
}

function _outputMayIndicateError(str: string) {
    if (str.toLowerCase().includes("error") &&
        !str.toLowerCase().includes("0 error") &&
        !str.toLowerCase().includes("no error") &&
        !str.toLowerCase().includes("any error")) {
        return true;
    }
    if (str.toLowerCase().includes("fail") &&
        !str.toLowerCase().includes("'t fail") &&
        !str.toLowerCase().includes("0 fail") &&
        !str.toLowerCase().includes("no fail") &&
        !str.toLowerCase().includes("any fail")) {
        return true;
    }
    return false;
}

/**
 * Uses `ios-deploy --nolldb` to start debugserver on iPhone.
 */
export async function debugserver(udid: string, progressCallback?: (event: any) => void): Promise<DebugServerResult>
{
    let time = new Date().getTime();

    let childProcess = spawn(IOS_DEPLOY(), ['--id', udid, '--nolldb', '--faster-path-search', '--json']);
    childProcess.stdout.setEncoding('utf8');

    // cancellationToken.onCancellationRequested(e => childProcess.kill());

    let result: DebugServerResult = await new Promise((resolve, reject) => {
    childProcess.stdout.on('data', (data:string) => {
                let event = JSON.parse(data);

                // event.Event is a string defined in ios-deploy. It can also be `Error`.
                if (event.Event === "DebugServerLaunched") {
                    resolve({status: DebugServerStatus.SUCCESS, port: event.Port});
                }
                progressCallback && progressCallback(event);
            });
    childProcess.on('error', (data:string) => {
            let errorObj = JSON.parse(data);
            if (errorObj.Status === 'The device is locked.') {
                resolve({status: DebugServerStatus.FAIL_PHONE_LOCKED, port: 0});
            } else {
                resolve({status: DebugServerStatus.FAIL, port: 0});
            }
        });
    });

    output.appendLine(`Debugserver started in ${new Date().getTime() - time} ms`);

    if (!result.port && result.status === DebugServerStatus.SUCCESS) {
        return {status: DebugServerStatus.FAIL, port: 0};
    } else {
    output.appendLine(`Debugserver Port: ${result.port}`);
        return result;
    }
}

export async function devicePathOfApp(udid:string, appBundleId: string): Promise<[string|null, boolean]> {
    try {
        const {stdout, stderr} = await execFile(IOS_DEPLOY(), ['--id', udid, '--list_bundle_id', '--json', '-k', 'Path']);
        const response = JSON.parse(stdout);
        const appBundleIdToInfo = response.Apps;
        const info = appBundleIdToInfo[appBundleId];
        if (info) {
            return [info.Path, true];
        } else {
            return [null, true];
        }
    } catch (error) {
        return [null, false];
    }
}
