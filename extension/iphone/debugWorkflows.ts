import * as vscode from 'vscode';
import * as devices from './devices';
import { Cancelable } from './cancelable';
import * as fs from 'fs';

let output: vscode.OutputChannel = null;
export function setOutput(output_: vscode.OutputChannel) {
    output = output_;
}

/**
 * Things to consider:
 * - delete the old output.
 * - when success, return `true`;
 * - when fail, prompt to let the user know, and bring the user to the log;
 * - when cancel, do nothing.
 * @return just a boolean to indicate success/failure. When failed, the upper layer just stops silently.
 */
export async function build(buildCommand:string, cwd:string, outputFilepath:string): Promise<boolean> {
    output.appendLine(`Building the app ${buildCommand}`);
    const buildStatus = await vscode.window.withProgress({
        "title": `[Build] ${buildCommand}`,
        location: vscode.ProgressLocation.Notification,
        "cancellable": true
        }, async (progress, token) => {
            return devices.runBuildCommand(buildCommand, cwd, progress, token);
        });

    // Some heuristics to check if build succeeded
    let successBasedOnFile = fs.existsSync(outputFilepath);

    if (buildStatus == devices.TaskStatus.FAIL || !successBasedOnFile) {
        const openLogAction = "Open log";
        const showOutputLog = await vscode.window.showErrorMessage("Build failed", openLogAction);
        if (showOutputLog === openLogAction) {
            output.show(false);
        }
        return false;
    }
    return buildStatus == devices.TaskStatus.SUCCESS;
}

/**
 * To get one connected device.
 * When there are 0 or multiple devices, wait for the user to adjust, or stop debugging if the user chooses to.
 */
export async function getConnectedDevice(): Promise<devices.Target|null> {
    output.appendLine(`getConnectedDevice...`);
    const [targets, success] = await devices.getConnectedDevices();
    if (success) {
        if (targets.length == 0) {
            const continueAction = "continue";
            const selectedAction = await vscode.window.showInformationMessage("No connected device", {
                    modal: true,
                    detail: "Please connect an iPhone and continue"},
                continueAction);
            if (selectedAction === continueAction) {
                return getConnectedDevice();
            } else {
                return null;
            }
        } else if (targets.length === 1) {
            return targets[0];
        } else {
            // multiple devices connected
            const continueAction = "continue";
            const selectedAction = await vscode.window.showInformationMessage("Multiple connected device", {
                    modal: true,
                    detail: "Please only connect one iPhone and continue"},
                continueAction);
            if (selectedAction === continueAction) {
                return getConnectedDevice();
            } else {
                return null;
            }
        }
    } else {
        await vscode.window.showInformationMessage("Unexpected error when detecting connected iPhones", {
            modal: true,
            detail: "Please try again"});
        return null;
    }
}

/**
 * Install the app and return the path on device.
 * If install isn't necessary, find and return the path.
 */
export async function installAndReturnPathInDevice(udid: string, appBundleId: string, pathOnMac: string): Promise<string|null> {
    output.appendLine(`Installing program ${pathOnMac} (bundle ID ${appBundleId}) to device ${udid}`);
    // Show progress
    return vscode.window.withProgress({
        "location": vscode.ProgressLocation.Notification,
        "title": "Installing",
        "cancellable": true
    }, async (progress, token) => {

        // Progress callback
        let lastProgress = 0;
        const progressCallback = (event:any) => {
            output.appendLine(JSON.stringify(event));
            let message = "";
            if (event.Event === "BundleCopy") {
                message = "Copying " + event.Path.replace(new RegExp(`^${pathOnMac}/?`), "");
            } else if (event.Event === "BundleInstall") {
                message = event.Status;
            }

            progress.report({increment: event.OverallPercent - lastProgress, message});
            lastProgress = event.OverallPercent;
        };

        // Cancel
        const cancelable = new Cancelable();
        token.onCancellationRequested((e) => {
            cancelable.cancel();
        });

        const [pathOnDevice, success] = await devices.installToDevice(udid, pathOnMac, progressCallback, cancelable);
        if (cancelable.isCanceled()) {
            return null;
        }
        if (!success) {
            // install failed. The only option is to retry from the beginning.
            await vscode.window.showInformationMessage("Unexpected error when installing the app", {
                modal: true,
                detail: "Please try again"});
            return null;
        } else {
            if (pathOnDevice) {
                return pathOnDevice;
            } else {
                return devicePathOfApp(udid, appBundleId);
            }
        }
    });
}

export async function devicePathOfApp(udid: string, appBundleId: string,): Promise<string|null>{
    const [path, success] = await devices.devicePathOfApp(udid, appBundleId);
    if (!success) {
        await vscode.window.showInformationMessage(`Unexpected error when searching for bundle ID "${appBundleId}" on the iPhone`, {
            modal: true,
            detail: "Please try again"});
        return null;
    } else if (!path) {
        await vscode.window.showInformationMessage(`Didn't find an app with bundle ID ${appBundleId} on the iPhone`, {
            modal: true,
            detail: "Please try again"});
        return null;
    } else {
        return path;
    }
}

let lldbSetupPromiseResolve:any = null;
export async function didStartLldbSetUp() {
    output.appendLine(`Connecting lldb to debugserver`);
    // Show progress
    return vscode.window.withProgress({
        "location": vscode.ProgressLocation.Notification,
        "title": "Connecting to the app on iPhone",
        "cancellable": true
    }, (progress, token) => {
        token.onCancellationRequested((e) => {
            vscode.debug.stopDebugging();
        });
        return new Promise((resolve, reject) => {
            lldbSetupPromiseResolve = resolve;
        });
    });
}

export async function didCompleteLldbSetUp() {
    if (lldbSetupPromiseResolve) {
        lldbSetupPromiseResolve();
    }
}
