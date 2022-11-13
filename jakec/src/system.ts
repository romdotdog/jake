import { readFileSync } from "fs";
import { resolve } from "path";
import { Span } from "./lexer";

export default abstract class System {
    public load(path: string): string {
        return readFileSync(path, "utf-8");
    }

    public resolve(path: string): string {
        return resolve(path);
    }

    public abstract error(x: Diagnostic): void;
}

export interface Diagnostic {
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

export class ChildSystem extends System {
    public error(x: Diagnostic) {
        process.send?.(x);
    }
}
