import { readFileSync, writeFileSync } from "fs";
import { relative, resolve } from "path";
import { Span } from "./lexer.js";

export default abstract class System {
    public load(path: string): string | undefined {
        try {
            return readFileSync(path, "utf-8");
        } catch {
            return undefined;
        }
    }

    public resolve(path: string): string {
        return resolve(path);
    }

    public relative(path: string): string {
        return relative(process.cwd(), path);
    }

    public write(path: string, content: string | Uint8Array) {
        writeFileSync(path, content);
    }

    public abstract error(x: Diagnostic, src: string): void;
}

export interface Diagnostic {
    path: string;
    span: Span;
    message: string;
    severity?: DiagnosticSeverity;
    relatedInformation?: DiagnosticRelatedInformation[];
    tags?: DiagnosticTag[];
}

export interface DiagnosticRelatedInformation {
    path: string;
    span: Span;
    message: string;
}

export enum DiagnosticTag {
    // faded out
    Unnecessary,
    // strikethrough
    Deprecated
}

export enum DiagnosticSeverity {
    // red underline
    Error,
    // yellow underline
    Warning,
    // blue underline
    Information,
    // three blue dots
    Hint
}

export interface Position {
    line: number;
    character: number;
}

export class ConsoleSystem extends System {
    public error(x: Diagnostic, src: string) {
        console.log(`"${x.span.link(src)}": ${x.message}`);
    }
}

export class ChildSystem extends System {
    public error(x: Diagnostic) {
        process.send?.(x);
    }
}
