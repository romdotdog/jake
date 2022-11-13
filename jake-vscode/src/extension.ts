import * as path from "path";
import { realpathSync } from "fs";
import { workspace, window, ExtensionContext } from "vscode";

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from "vscode-languageclient/node";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    console.log(context.asAbsolutePath("."));
    const serverModule = path.join(
        realpathSync(context.asAbsolutePath(".")),
        "..",
        "jake-lsp",
        "dist",
        "server.js"
    );

    console.log(serverModule);

    const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "jake" }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher("**/.clientrc")
        }
    };

    client = new LanguageClient("jake", "Jake", serverOptions, clientOptions);

    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
