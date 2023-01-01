import {
    TextDocuments,
    createConnection,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
    Range,
    DiagnosticTag,
    WorkspaceFolder
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { fork } from "child_process";
import { Diagnostic as JakeDiagnostic } from "../../jakec/src/system";

const connection = createConnection();
const documents = new TextDocuments(TextDocument);
let workspaceFolders: WorkspaceFolder[] | null | undefined;
connection.onInitialize(h => {
    workspaceFolders = h.workspaceFolders;
    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                save: true
            }
        }
    };
});

function validate(activeDocument: TextDocument): void {
    /*console.log(
        Diagnostic.create(
            Range.create(0, 0, 0, 10),
            "Something is wrong here",
            DiagnosticSeverity.Warning
        )
    );*/
    const activeUri = URI.parse(activeDocument.uri);
    if (workspaceFolders !== null && workspaceFolders !== undefined && activeUri.scheme == "file") {
        const workspaceFolder = workspaceFolders
            .map(folder => URI.parse(folder.uri))
            .find(folderUri => activeUri.fsPath.startsWith(folderUri.fsPath));
        if (workspaceFolder !== undefined) {
            const child = fork("jakec/dist/index.js", ["--child"], { cwd: workspaceFolder.fsPath });
            const allDiagnostics: Map<string, [TextDocument | undefined, Diagnostic[]]> = new Map();
            child.on("message", (x: JakeDiagnostic) => {
                console.log(x);
                let diagnosticsForPath = allDiagnostics.get(x.path);
                if (diagnosticsForPath === undefined) {
                    const document = documents.get(URI.file(x.path).toString());
                    diagnosticsForPath = [document, []];
                    allDiagnostics.set(x.path, diagnosticsForPath);
                }
                const document = diagnosticsForPath[0];
                if (document !== undefined) {
                    diagnosticsForPath[1].push({
                        range: Range.create(
                            document.positionAt(x.span.start),
                            document.positionAt(x.span.end)
                        ),
                        message: x.message,
                        severity: <DiagnosticSeverity | undefined>x.severity,
                        tags: <DiagnosticTag[] | undefined>x.tags,
                        source: "jake"
                    });
                }
            });
            child.on("close", () => {
                for (const [file, [document, diagnostics]] of allDiagnostics.entries()) {
                    console.log(file);
                    if (document !== undefined) {
                        connection.sendDiagnostics({
                            uri: document.uri,
                            version: document.version,
                            diagnostics
                        });
                    }
                }
            });
        } else {
            console.log("file does not belong to workspace");
        }
    } else {
        console.log("no workspaces found");
    }
}

documents.onDidOpen(event => {
    validate(event.document);
});

documents.onDidSave(event => {
    validate(event.document);
});

documents.listen(connection);
connection.listen();
