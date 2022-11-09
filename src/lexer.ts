// heavily based on llex.c
export default class Lexer {
	private lines: number[] = [];
	private p = 0;

	constructor(private src: string) {}

	private skip() {
		return ++this.p;
	}

	private get() {
		return this.src.charAt(this.skip());
	}

	private current() {
		return this.src.charAt(this.p);
	}

	private inclineNumber() {
		// assert \n, \r
		const current = this.get();
		if (isNewline(current)) {
			this.skip();
		}
		this.lines.push(this.p);
	}

	private maybeTakeEquals(normalToken: Token, equalsToken: Token) {
		if (this.get() == "=") {
			this.skip();
			return equalsToken;
		}
		return normalToken;
	}

	public next(): Token {
		while (true) {
			const current = this.current();
			switch (current) {
				case "\n":
				case "\r": {
					this.inclineNumber();
					continue;
				}
				case "/": {
					const current = this.get();
					if (current == "/") {
						while (!isNewlineOrEOF(this.get()));
					} else if (current == "*") {
						while (true) {
							while (!isAsteriskOrEOF(this.get()));
							if (isSlashOrEOF(this.get())) {
								break;
							}
						}
					} else if (current == "=") {
						this.skip();
						return Token.SlashEquals;
					} else {
						return Token.Slash;
					}

					continue;
				}
				case "*": {
					return this.maybeTakeEquals(Token.Asterisk, Token.AsteriskEquals);
				}
				case "%": {
					return this.maybeTakeEquals(Token.Percent, Token.PercentEquals);
				}
				case "+": {
					return this.maybeTakeEquals(Token.Plus, Token.PlusEquals);
				}
				case "-": {
					const current = this.get();
					if (current == ">") {
						this.skip();
						return Token.Arrow;
					} else if (current == "=") {
						this.skip();
						return Token.MinusEquals;
					} else {
						return Token.Minus;
					}
				}
				case "<": {
					const current = this.get();
					if (current == "<") {
						return this.maybeTakeEquals(Token.LeftAngleLeftAngle, Token.LeftAngleLeftAngleEquals);
					} else if (current == "=") {
						this.skip();
						return Token.LeftAngleEquals;
					} else {
						return Token.LeftAngle;
					}
				}
				case ">": {
					const current = this.get();
					if (current == ">") {
						return this.maybeTakeEquals(Token.RightAngleRightAngle, Token.RightAngleRightAngleEquals);
					} else if (current == "=") {
						this.skip();
						return Token.RightAngleEquals;
					} else {
						return Token.RightAngle;
					}
				}
				case "=": {
					return this.maybeTakeEquals(Token.Equals, Token.EqualsEquals);
				}
				case "!": {
					return this.maybeTakeEquals(Token.Exclamation, Token.ExclamationEquals);
				}
				case "&": {
					return this.maybeTakeEquals(Token.Ampersand, Token.AmpersandEquals);
				}
				case "|": {
					return this.maybeTakeEquals(Token.Pipe, Token.PipeEquals);
				}
				case "^": {
					return this.maybeTakeEquals(Token.Caret, Token.CaretEquals);
				}
				case "^": {
					return this.maybeTakeEquals(Token.Tilde, Token.TildeEquals);
				}
				case "(": {
					this.skip();
					return Token.LeftParen;
				}
				case ")": {
					this.skip();
					return Token.RightParen;
				}
				case "[": {
					this.skip();
					return Token.LeftBracket;
				}
				case "]": {
					this.skip();
					return Token.RightBracket;
				}
				case "{": {
					this.skip();
					return Token.LeftBrace;
				}
				case "}": {
					this.skip();
					return Token.RightBrace;
				}
				case ":": {
					this.skip();
					return Token.Colon;
				}
				case ";": {
					this.skip();
					return Token.Semicolon;
				}
				case ".": {
					if (this.get() == ".") {
						this.skip();
						return Token.PeriodPeriod;
					}
					return Token.Period;
				}
				case ",": {
					this.skip();
					return Token.Comma;
				}
				case "": {
					return Token.EOF;
				}
				default: {
				}
			}
		}
	}
}

function isSlashOrEOF(char: string) {
	return char == "" || char == "/";
}

function isAsteriskOrEOF(char: string) {
	return char == "" || char == "*";
}

function isNewlineOrEOF(char: string) {
	return char == "" || isNewline(char);
}

function isNewline(char: string) {
	return char == "\n" || char == "\r";
}

enum Token {
	Asterisk,
	AsteriskEquals,
	Slash,
	SlashEquals,
	Percent,
	PercentEquals,
	Plus,
	PlusEquals,
	Minus,
	MinusEquals,
	Arrow,
	LeftAngle,
	LeftAngleEquals,
	LeftAngleLeftAngle,
	LeftAngleLeftAngleEquals,
	RightAngle,
	RightAngleEquals,
	RightAngleRightAngle,
	RightAngleRightAngleEquals,
	Equals,
	EqualsEquals,
	Exclamation,
	ExclamationEquals,
	Ampersand,
	AmpersandEquals,
	Pipe,
	PipeEquals,
	Caret,
	CaretEquals,
	Tilde,
	TildeEquals,
	LeftParen,
	RightParen,
	LeftBracket,
	RightBracket,
	LeftBrace,
	RightBrace,
	Colon,
	Semicolon,
	Period,
	PeriodPeriod,
	Comma,
	EOF
}
