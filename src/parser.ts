import Lexer, { Span, Token } from "./lexer.js";
import * as AST from "./ast.js";

export class Parser {
    private token: Token;
    private topLevelContext = TopLevelContext.Imports;

    private error(span: Span, message: string) {
        console.log(`${span.start} - ${span.end}: ${message}`);
    }

    private get start(): number {
        return this.lexer.start;
    }

    private from(start: number): Span {
        return { start, end: this.lexer.p };
    }

    private next() {
        this.token = this.lexer.next();
    }

    private eat(token: Token): boolean {
        if (this.token == token) {
            this.next();
            return true;
        }
        return false;
    }

    constructor(private lexer: Lexer) {
        this.token = this.lexer.next();
    }

    public import_(start: number): AST.Import {

    }

    public hostImport(start: number): AST.HostImport {

    }

    public topLevel(source: AST.Source) {
        const start = this.start;
        if (this.eat(Token.Import)) {
            if (this.eat(Token.Host)) {
                const hostImport = this.hostImport(start);
                if (this.topLevelContext > TopLevelContext.HostImports) {
                    this.error(hostImport.span, "Move this import before all items.")
                } else {
                    this.topLevelContext = TopLevelContext.HostImports;
                }
            } else {
                const import_ = this.import_(start);
                if (this.topLevelContext > TopLevelContext.Imports) {
                    this.error(import_.span, "Move this import before all items and host imports.")
                } else {
                    this.topLevelContext = TopLevelContext.Imports;
                }
            }
        }
    }

    public parse(): AST.Source {
        const source = new AST.Source([], [], []);
        while (this.token != Token.EOF) {
            this.topLevel(source);
        }
        return source;
    }
}

enum TopLevelContext {
    Imports,
    HostImports,
    Items
}