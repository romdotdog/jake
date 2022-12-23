import { readFileSync } from "fs";
import { relative, resolve } from "path";
import { Span } from "./lexer";

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
