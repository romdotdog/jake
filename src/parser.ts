import Lexer, { Span, Token } from "./lexer.js";
import * as AST from "./ast.js";

export default class Parser {
    private lookahead: Token;
    private buffer: number | string | null = null;
    private start: number = 0;
    private end: number = 0;
    private topLevelContext = TopLevelContext.Imports;
    private source = new AST.Source([], [], []);
    private quiet = false;

    private error(span: Span, message: string, important: boolean = false) {
        if (!(important || this.quiet))
            console.log(`${span.start} - ${span.end} / "${this.lexer.link(span)}": ${message}`);
    }

    private from(start: number): Span {
        return { start, end: this.end };
    }

    private get span(): Span {
        return this.from(this.start);
    }

    private get lookaheadSpan(): Span {
        return { start: this.lexer.start, end: this.lexer.p };
    }

    private next() {
        this.buffer = this.lexer.buffer;
        this.start = this.lexer.start;
        this.end = this.lexer.p;
        this.lookahead = this.lexer.next();
    }

    // unbounded lookahead. reserved for A<B> and A<B, C>(1)
    private fork<T>(f: () => T | null): T | null {
        const { buffer, start, end } = this;
        const { buffer: lexerBuffer, start: lexerStart, p: lexerP } = this.lexer;
        this.quiet = true;
        const result = f();
        this.quiet = false;
        if (result === null) {
            this.buffer = buffer;
            this.start = start;
            this.end = end;
            this.lexer.buffer = lexerBuffer;
            this.lexer.start = lexerStart;
            this.lexer.p = lexerP;
        }
        return result;
    }

    constructor(private lexer: Lexer) {
        this.lookahead = this.lexer.next();
    }

    private eat(token: Token): boolean {
        if (this.lookahead == token) {
            this.next();
            return true;
        }
        return false;
    }

    private readString(): string {
        return <string>this.buffer;
    }

    private readStringLiteral(): AST.StringLiteral {
        return new AST.StringLiteral(this.span, this.readString());
    }

    private comma<T>(f: () => T): T[] {
        const result: T[] = [];
        do {
            result.push(f());
        } while (this.eat(Token.Comma));
        return result;
    }

    private enclose<T>(open: Token, close: Token, f: () => T): T | null {
        if (this.eat(open)) {
            if (this.eat(close)) {
                return null;
            }
            const result = f();
            if (!this.eat(close)) {
                this.error(this.lookaheadSpan, "expected closing delimiter");
            }
            return result;
        } else {
            this.error(this.lookaheadSpan, "expected opening delimiter");
        }
        return null;
    }

    private literal(): AST.Atom | null {
        if (this.eat(Token.Ident)) {
            const maybeStackTy = stackTy.get(<string>this.buffer);
            if (maybeStackTy !== undefined) {
                return new AST.StackTy(this.span, maybeStackTy);
            }
            const maybeHeapTy = heapTy.get(<string>this.buffer);
            if (maybeHeapTy !== undefined) {
                return new AST.HeapTy(this.span, maybeHeapTy);
            }
            return new AST.Ident(this.span);
        } else if (this.eat(Token.Number)) {
            return new AST.NumberLiteral(this.span, <number>this.buffer);
        } else if (this.eat(Token.String)) {
            return new AST.StringLiteral(this.span, <string>this.buffer);
        } else if (this.eat(Token.LeftParen)) {
            const start = this.start;
            const array = this.atomArray();
            if (!this.eat(Token.RightParen)) {
                this.error(this.lookaheadSpan, "expected `)`", true);
            }
            return new AST.Parentheses(this.from(start), array);
        }
        this.error(this.lookaheadSpan, "invalid expression");
        return null;
    }

    private simpleAtom(base: AST.Atom | null): AST.Atom | null {
        const start = this.start;
        if (this.eat(Token.LeftParen)) {
            const array = this.atomArray();
            return this.simpleAtom(new AST.Call(this.from(start), base, null, array));
        } else if (this.lookahead == Token.LeftAngle) {
            // Here be dragons 🐉
            type Speculation = [tyArray: AST.Atom[], args: AST.Atom[] | null] | null;
            const speculation: Speculation = this.fork(() => {
                this.next();

                const tyArray = [];
                do {
                    const ty = this.atom(true);
                    if (ty === null) {
                        return null;
                    }
                    tyArray.push(ty);
                } while (this.eat(Token.Comma));
                if (!this.eat(Token.RightAngle)) {
                    return null;
                }
                let args = null;
                if (this.eat(Token.LeftParen)) {
                    args = [];
                    do {
                        const atom = this.atom();
                        if (atom === null) {
                            return null;
                        }
                        args.push(atom);
                    } while (this.eat(Token.Comma));
                    if (!this.eat(Token.RightParen)) {
                        this.error(this.lookaheadSpan, "expected `)`");
                    }
                }
                return [tyArray, args]
            });
            if (speculation !== null) {
                const [tyArray, args] = speculation;
                if (args === null) {
                    return this.simpleAtom(new AST.TypeCall(this.from(start), base, tyArray));
                } else {
                    return this.simpleAtom(new AST.Call(this.from(start), base, tyArray, args));
                }
            }
        }
        return base;
    }

    private primaryAtom(): AST.Atom | null {
        const start = this.start;
        const op = unOps.get(this.lookahead);
        if (op !== undefined) {
            this.next();
            const atom = this.primaryAtom();
            return new AST.Unary(this.from(start), op, atom);
        }
        return this.simpleAtom(this.literal());
    }

    private subatom(start: number, left: AST.Atom | null, minPrec: number, ignoreGt: boolean = false): AST.Atom | null {
        while (true) {
            const opInfo = binOps.get(this.lookahead);
            if (opInfo == null) break;
            const [op, prec] = opInfo;
            if (ignoreGt && op == AST.BinOp.Gt) break;
            if (prec >= minPrec) {
                this.next();
                let rightStart = this.start;
                let right = this.primaryAtom();
                while (true) {
                    const nOpInfo = binOps.get(this.lookahead);
                    if (nOpInfo == null) break;
                    const [nOp, nPrec] = nOpInfo;
                    if (nPrec > prec) {
                        right = this.subatom(rightStart, right, prec + 1);
                    } else if (nOp == AST.BinOp.Arrow && nPrec == prec) {
                        right = this.subatom(rightStart, right, prec);
                    } else {
                        break;
                    }
                }

                left = new AST.Binary(this.from(start), op, left, right);
            }
        }
        return left;
    }

    private atom(ignoreGt: boolean = false): AST.Atom | null {
        const start = this.start;
        const pure = this.eat(Token.Pure);
        const atom = this.subatom(this.start, this.primaryAtom(), 0, ignoreGt);
        if (pure) {
            return new AST.Pure(this.from(start), atom);
        }
        return atom;
    }

    private atomArray(): AST.Atom[] {
        return filterNull(this.comma(() => this.atom()));
    }

    private eatSemi() {
        if (!this.eat(Token.Semicolon)) {
            this.error(this.lookaheadSpan, "`;` expected");
        }
    }

    private statement(): AST.Statement | null {
        const start = this.start;
        if (this.eat(Token.Let)) {
            const pattern = this.pattern();
            if (this.eat(Token.Equals)) {
                const atom = this.atom();
                return new AST.Let(this.from(start), pattern, atom);
            } else {
                this.error(this.span, "`=` expected - `let` statements require initializers");
            }
            this.eatSemi();
        } else if (this.eat(Token.Return)) {
            const atom = this.atom();
            this.eatSemi();
            return new AST.Return(this.from(start), atom);
        }

        const atom = this.atom();
        const opKind = assignOps.get(this.lookahead);
        if (opKind) {
            const right = this.atom();
            this.eatSemi();
            return new AST.Assign(this.from(start), opKind, atom, right);
        }
        this.eatSemi();
        return atom;
    }

    private recoverStatements() {
        while (!statementRecovery.has(this.lookahead)) {
            this.next();
        }
    }

    private statements(): AST.Statement[] {
        const statements = [];
        if (this.eat(Token.LeftBrace)) {
            while (!this.eat(Token.RightBrace)) {
                const statement = this.statement();
                if (statement == null) {
                    this.recoverStatements();
                    continue;
                }
                statements.push(statement);
                if (this.lookahead == Token.EOF) {
                    this.error(this.span, "expected `}` as part of block");
                    break;
                }
            }
        } else {
            this.error(this.lookaheadSpan, "expected `{` as part of block");
        }
        return statements;
    }

    private pattern(): AST.Pattern | null {
        if (this.eat(Token.Ident)) {
            const start = this.start;
            const ident = this.span;
            if (!this.eat(Token.Colon)) {
                this.error(this.lookaheadSpan, "expected `:` as part of binding");
            }
            const ty = this.atom();
            return new AST.Binding(this.from(start), ident, ty);
        }
        this.error(this.lookaheadSpan, "invalid pattern");
        return null;
    }

    private function_(exported: boolean): AST.Item | null {
        const start = this.start;
        if (this.eat(Token.Ident)) {
            const name = this.span;
            let ty = null;
            if (this.eat(Token.LeftAngle)) {
                ty = this.comma(() => {
                    return this.atom(true);
                });
                if (!this.eat(Token.RightAngle)) {
                    this.error(this.lookaheadSpan, "expected `>`");
                }
            }
            const params = this.enclose(Token.LeftParen, Token.RightParen, () => {
                return this.comma(() => {
                    return this.pattern();
                });
            }) ?? [];
            let returnTy = undefined;
            if (this.eat(Token.Colon)) {
                returnTy = this.atom();
            }
            const signature = new AST.FunctionSignature(this.from(start), exported, name, ty !== null ? filterNull(ty) : null, filterNull(params), returnTy);
            const body = this.statements();
            return new AST.FunctionDeclaration(this.from(start), signature, body);
        }
        return null;
    }

    private importAs(import_: AST.Import, context: ImportContext): ImportContext {
        const asStart = this.start;
        if (this.eat(Token.Ident)) {
            if (import_.namespace !== null) {
                this.error(this.from(asStart), "cannot declare a namespace twice");
            }
            if (context > ImportContext.As) {
                this.error(this.from(asStart), "move `as` before `with` and `without`");
            }
            import_.namespace = this.span;
        } else {
            this.error(this.from(asStart), "expected identifier for namespace");
        }
        return context;
    }

    private importWith(import_: AST.Import, context: ImportContext): ImportContext {
        const withoutSpan = this.start;
        if (import_.with_.length > 0) {
            // TODO: guard against with { } with { ... }
            this.error(this.from(withoutSpan), "cannot use `with` twice");
        }
        if (context > ImportContext.With) {
            this.error(this.from(withoutSpan), "move `with` before `without`");
        } else {
            context = ImportContext.With;
        }

        this.enclose(Token.LeftBrace, Token.RightBrace, () => {
            this.comma(() => {
                if (this.eat(Token.Ident)) {
                    const name = this.span;
                    if (this.eat(Token.As)) {
                        if (this.eat(Token.Ident)) {
                            const alias = this.span;
                            import_.with_.push([name, alias]);
                        } else {
                            this.error(this.lookaheadSpan, "expected identifier after `as`");
                        }
                    } else {
                        import_.with_.push([name, name]);
                    }
                } else {
                    this.error(this.lookaheadSpan, "expected identifier");
                }
            });
        });

        return context;
    }

    private importWithout(import_: AST.Import): ImportContext {
        const withoutSpan = this.start;
        if (import_.without.length > 0) {
            // TODO: guard against without { } without { ... }
            this.error(this.from(withoutSpan), "cannot use `without` twice");
        }

        this.enclose(Token.LeftBrace, Token.RightBrace, () => {
            this.comma(() => {
                if (this.eat(Token.Ident)) {
                    import_.without.push(this.span);
                } else {
                    this.error(this.lookaheadSpan, "expected identifier");
                }
            });
        });

        return ImportContext.Without;
    }

    private import_(start: number): AST.Import | null {
        if (this.eat(Token.String)) {
            const path = this.readStringLiteral();
            const import_ = new AST.Import(this.from(start), path, null, [], []);

            let context = ImportContext.As;
            while (true) {
                if (this.eat(Token.As)) {
                    context = this.importAs(import_, context);
                } else if (this.eat(Token.With)) {
                    context = this.importWith(import_, context);
                } else if (this.eat(Token.Without)) {
                    context = this.importWithout(import_);
                } else {
                    break;
                }
            }
            if (!this.eat(Token.Semicolon)) {
                this.error(this.span, "expected semicolon after import");
            }
            return import_;
        } else {
            this.error(this.span, "expected `host` or import path");
        }
        return null;
    }

    private hostImport(start: number): AST.HostImport | null {
        return null;
    }

    private recoverTopLevel() {
        while (!topLevelRecovery.has(this.lookahead)) {
            this.next();
        }
    }

    private topLevel() {
        const start = this.start;
        if (this.eat(Token.Import)) {
            if (this.eat(Token.Host)) {
                const hostImport = this.hostImport(start);
                if (hostImport == null) {
                    this.recoverTopLevel();
                    return;
                }
                if (this.topLevelContext > TopLevelContext.HostImports) {
                    this.error(hostImport.span, "Move this import before all items.");
                } else {
                    this.topLevelContext = TopLevelContext.HostImports;
                }
                this.source.hostImports.push(hostImport);
            } else {
                const import_ = this.import_(start);
                if (import_ == null) {
                    this.recoverTopLevel();
                    return;
                }
                if (this.topLevelContext > TopLevelContext.Imports) {
                    this.error(import_.span, "Move this import before all items and host imports.")
                } else {
                    this.topLevelContext = TopLevelContext.Imports;
                }
                this.source.imports.push(import_);
            }
        } else {
            const exported = this.eat(Token.Export);
            if (this.eat(Token.Function)) {
                const function_ = this.function_(exported);
                if (function_ == null) {
                    this.recoverTopLevel();
                    return;
                }
                this.source.items.push(function_);
            }
        }
    }

    public parse(): AST.Source {
        while (this.lookahead != Token.EOF) {
            this.topLevel();
        }
        return this.source;
    }
}

function filterNull<T>(arr: Array<T | null>): T[] {
    return arr.filter((v: T | null): v is T => v !== null);
}

const heapTy = new Map([
    ["i8", AST.HeapTyEnum.I8],
    ["u8", AST.HeapTyEnum.U8],
    ["i16", AST.HeapTyEnum.I16],
    ["u16", AST.HeapTyEnum.U16],
]);

const stackTy = new Map([
    ["i32", AST.StackTyEnum.I32],
    ["u32", AST.StackTyEnum.U32],
    ["f32", AST.StackTyEnum.F32],
    ["i64", AST.StackTyEnum.I64],
    ["u64", AST.StackTyEnum.U64],
    ["f64", AST.StackTyEnum.F64],
]);

const assignOps = new Map([
    [Token.Equals, AST.BinOp.Id],
    [Token.AsteriskEquals, AST.BinOp.Mul],
    [Token.SlashEquals, AST.BinOp.Div],
    [Token.PercentEquals, AST.BinOp.Mod],
    [Token.PlusEquals, AST.BinOp.Add],
    [Token.MinusEquals, AST.BinOp.Sub],
    [Token.LeftAngleLeftAngleEquals, AST.BinOp.Shl],
    [Token.RightAngleRightAngleEquals, AST.BinOp.Shr],
    [Token.AmpersandEquals, AST.BinOp.And],
    [Token.PipeEquals, AST.BinOp.Or],
    [Token.CaretEquals, AST.BinOp.Xor],
]);

const binOps = new Map([
    [Token.Asterisk, [AST.BinOp.Mul, 10]],
    [Token.Slash, [AST.BinOp.Div, 10]],
    [Token.Percent, [AST.BinOp.Mod, 10]],
    [Token.Plus, [AST.BinOp.Add, 11]],
    [Token.Minus, [AST.BinOp.Sub, 11]],
    [Token.LeftAngleLeftAngle, [AST.BinOp.Shl, 12]],
    [Token.RightAngleRightAngle, [AST.BinOp.Shr, 13]],
    [Token.LeftAngle, [AST.BinOp.Lt, 14]],
    [Token.LeftAngleEquals, [AST.BinOp.Le, 14]],
    [Token.RightAngle, [AST.BinOp.Gt, 14]],
    [Token.RightAngleEquals, [AST.BinOp.Ge, 14]],
    [Token.EqualsEquals, [AST.BinOp.Eq, 15]],
    [Token.ExclamationEquals, [AST.BinOp.Ne, 15]],
    [Token.Ampersand, [AST.BinOp.And, 16]],
    [Token.Pipe, [AST.BinOp.Or, 17]],
    [Token.Caret, [AST.BinOp.Xor, 18]],
    [Token.Arrow, [AST.BinOp.Arrow, 19]]
]);

const unOps = new Map([
    [Token.Exclamation, AST.UnOp.LNot],
    [Token.Tilde, AST.UnOp.BNot],
    [Token.Minus, AST.UnOp.Neg]
])

const statementRecovery = new Set([Token.Semicolon, Token.RightBrace, Token.EOF]);
const topLevelRecovery = new Set([Token.Import, Token.Function, Token.Type, Token.Export, Token.EOF]);
enum TopLevelContext {
    Imports,
    HostImports,
    Items
}

enum ImportContext {
    As,
    With,
    Without
}