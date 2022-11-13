import {
    TextDocuments,
    createConnection,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
    Range,
    DiagnosticTag
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { fork } from "child_process";
import { Diagnostic as JakeDiagnostic } from "../../jakec/src/system";

const connection = createConnection();
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
    capabilities: {
        textDocumentSync: {
            openClose: true,
            save: true
        }
    }
}));

function validate(document: TextDocument): void {
    /*console.log(
        Diagnostic.create(
            Range.create(0, 0, 0, 10),
            "Something is wrong here",
            DiagnosticSeverity.Warning
        )
    );*/
    const uri = URI.parse(document.uri);
    if (uri.scheme == "file") {
        console.log(uri.fsPath);
        const child = fork("jakec/dist/index.js", [uri.fsPath, "--child"]);
        const diagnostics: Diagnostic[] = [];
        child.on("message", (x: JakeDiagnostic) => {
            //console.log(x);
            diagnostics.push({
                range: Range.create(
                    document.positionAt(x.span.start),
                    document.positionAt(x.span.end)
                ),
                message: x.message,
                severity: <DiagnosticSeverity | undefined>x.severity,
                tags: <DiagnosticTag[] | undefined>x.tags,
                source: "jake"
            });
        });
        child.on("close", () => {
            connection.sendDiagnostics({
                uri: document.uri,
                version: document.version,
                diagnostics
            });
        });
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
