const TOKEN_TYPES = {
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LT: "LT",
  LTEQ: "LTEQ",
  COLON: "COLON",
  EQUAL: "EQUAL",
  COMMA: "COMMA",
  AND: "AND",
  OR: "OR",
  MINUS: "MINUS",
  ID: "ID",
  EOF: "EOF"
};

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isWhitespace(ch) {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: TOKEN_TYPES.LPAREN, value: ch });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ type: TOKEN_TYPES.RPAREN, value: ch });
      i += 1;
      continue;
    }

    if (ch === ":") {
      tokens.push({ type: TOKEN_TYPES.COLON, value: ch });
      i += 1;
      continue;
    }

    if (ch === "=") {
      tokens.push({ type: TOKEN_TYPES.EQUAL, value: ch });
      i += 1;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: TOKEN_TYPES.COMMA, value: ch });
      i += 1;
      continue;
    }

    if (ch === "<") {
      if (expr[i + 1] === "<") {
        tokens.push({ type: TOKEN_TYPES.LTEQ, value: "<<" });
        i += 2;
      } else {
        tokens.push({ type: TOKEN_TYPES.LT, value: "<" });
        i += 1;
      }
      continue;
    }

    if (isDigit(ch)) {
      let j = i + 1;
      while (j < expr.length && isDigit(expr[j])) {
        j += 1;
      }
      tokens.push({ type: TOKEN_TYPES.ID, value: expr.slice(i, j) });
      i = j;
      continue;
    }

    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z]/.test(expr[j])) {
        j += 1;
      }
      const raw = expr.slice(i, j);
      const upper = raw.toUpperCase();
      if (upper === "AND") {
        tokens.push({ type: TOKEN_TYPES.AND, value: raw });
      } else if (upper === "OR") {
        tokens.push({ type: TOKEN_TYPES.OR, value: raw });
      } else if (upper === "MINUS") {
        tokens.push({ type: TOKEN_TYPES.MINUS, value: raw });
      } else {
        throw new Error(`Unsupported token '${raw}'. Allowed operators: <<, <, :, =, AND, OR, MINUS`);
      }
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: TOKEN_TYPES.EOF, value: "" });
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  consume(expectedType) {
    const token = this.peek();
    if (token.type !== expectedType) {
      throw new Error(`Expected ${expectedType} but found ${token.type}`);
    }
    this.index += 1;
    return token;
  }

  parse() {
    const expr = this.parseOr();
    if (this.peek().type !== TOKEN_TYPES.EOF) {
      throw new Error(`Unexpected token '${this.peek().value}'`);
    }
    return expr;
  }

  parseOr() {
    let left = this.parseAndMinus();
    while (this.peek().type === TOKEN_TYPES.OR) {
      this.consume(TOKEN_TYPES.OR);
      const right = this.parseAndMinus();
      left = { type: "or", left, right };
    }
    return left;
  }

  parseAndMinus() {
    let left = this.parseRefined();
    while (this.peek().type === TOKEN_TYPES.AND || this.peek().type === TOKEN_TYPES.MINUS) {
      const operator = this.peek().type;
      this.index += 1;
      const right = this.parseRefined();
      left = {
        type: operator === TOKEN_TYPES.AND ? "and" : "minus",
        left,
        right
      };
    }
    return left;
  }

  parseRefined() {
    let focus = this.parseUnary();
    if (this.peek().type === TOKEN_TYPES.COLON) {
      this.consume(TOKEN_TYPES.COLON);
      const refinement = this.parseRefinementOr();
      focus = {
        type: "refined",
        focus,
        refinement
      };
    }
    return focus;
  }

  parseUnary() {
    if (this.peek().type === TOKEN_TYPES.LTEQ) {
      this.consume(TOKEN_TYPES.LTEQ);
      const target = this.parseUnary();
      if (target.type !== "id") {
        throw new Error("Operator '<<' must be followed by a concept id");
      }
      return { type: "desc", conceptId: target.conceptId, includeSelf: true };
    }

    if (this.peek().type === TOKEN_TYPES.LT) {
      this.consume(TOKEN_TYPES.LT);
      const target = this.parseUnary();
      if (target.type !== "id") {
        throw new Error("Operator '<' must be followed by a concept id");
      }
      return { type: "desc", conceptId: target.conceptId, includeSelf: false };
    }

    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();

    if (token.type === TOKEN_TYPES.ID) {
      this.consume(TOKEN_TYPES.ID);
      return { type: "id", conceptId: token.value };
    }

    if (token.type === TOKEN_TYPES.LPAREN) {
      this.consume(TOKEN_TYPES.LPAREN);
      const inner = this.parseOr();
      this.consume(TOKEN_TYPES.RPAREN);
      return inner;
    }

    throw new Error(`Unexpected token '${token.value || token.type}'`);
  }

  parseRefinementOr() {
    let left = this.parseRefinementAnd();
    while (this.peek().type === TOKEN_TYPES.OR) {
      this.consume(TOKEN_TYPES.OR);
      const right = this.parseRefinementAnd();
      left = { type: "refOr", left, right };
    }
    return left;
  }

  parseRefinementAnd() {
    let left = this.parseAttributeConstraint();
    while (this.peek().type === TOKEN_TYPES.AND || this.peek().type === TOKEN_TYPES.COMMA) {
      this.index += 1;
      const right = this.parseAttributeConstraint();
      left = { type: "refAnd", left, right };
    }
    return left;
  }

  parseAttributeConstraint() {
    const attribute = this.peek();
    if (attribute.type !== TOKEN_TYPES.ID) {
      throw new Error(`Expected attribute concept id but found '${attribute.value || attribute.type}'`);
    }
    this.consume(TOKEN_TYPES.ID);
    this.consume(TOKEN_TYPES.EQUAL);
    const value = this.parseUnary();
    return {
      type: "attrEq",
      attributeTypeId: attribute.value,
      value
    };
  }
}

function toArray(setOrArray) {
  if (Array.isArray(setOrArray)) return setOrArray;
  if (setOrArray instanceof Set) return Array.from(setOrArray);
  return [];
}

function unionSets(left, right, maxResults) {
  const merged = new Set(left);
  for (const value of right) {
    merged.add(value);
    if (merged.size > maxResults) {
      throw new Error(`ECL result exceeds max size (${maxResults})`);
    }
  }
  return merged;
}

function intersectSets(left, right) {
  const result = new Set();
  const rightSet = right instanceof Set ? right : new Set(right);
  for (const value of left) {
    if (rightSet.has(value)) {
      result.add(value);
    }
  }
  return result;
}

function minusSets(left, right) {
  const result = new Set();
  const rightSet = right instanceof Set ? right : new Set(right);
  for (const value of left) {
    if (!rightSet.has(value)) {
      result.add(value);
    }
  }
  return result;
}

export function parseEclExpression(expr) {
  const normalized = String(expr || "").trim();
  if (!normalized) {
    throw new Error("expr is required");
  }
  const parser = new Parser(tokenize(normalized));
  return parser.parse();
}

export function validateEclExpression(expr) {
  try {
    const ast = parseEclExpression(expr);
    return {
      ok: true,
      ast
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function evaluateNode(node, options) {
  const { expandDescendants, maxResults } = options;

  if (node.type === "id") {
    return new Set([node.conceptId]);
  }

  if (node.type === "desc") {
    const descendants = await expandDescendants(node.conceptId, { includeSelf: node.includeSelf });
    const scoped = new Set(toArray(descendants).map((id) => String(id)));
    if (!node.includeSelf) {
      scoped.delete(String(node.conceptId));
    }
    if (scoped.size > maxResults) {
      throw new Error(`ECL result exceeds max size (${maxResults})`);
    }
    return scoped;
  }

  if (node.type === "refined") {
    const focus = await evaluateNode(node.focus, options);
    const attributeMatches = await evaluateRefinement(node.refinement, options);
    return intersectSets(focus, attributeMatches);
  }

  const left = await evaluateNode(node.left, options);
  const right = await evaluateNode(node.right, options);

  if (node.type === "or") {
    return unionSets(left, right, maxResults);
  }

  if (node.type === "and") {
    return intersectSets(left, right);
  }

  if (node.type === "minus") {
    return minusSets(left, right);
  }

  throw new Error(`Unsupported AST node type '${node.type}'`);
}

async function evaluateRefinement(node, options) {
  const { expandRelationshipAttribute, maxResults } = options;

  if (node.type === "attrEq") {
    if (typeof expandRelationshipAttribute !== "function") {
      throw new Error("This ECL expression uses attribute refinements, but no relationship attribute expansion callback was provided");
    }
    const targetValues = await evaluateNode(node.value, options);
    const matches = await expandRelationshipAttribute(node.attributeTypeId, targetValues, { maxResults });
    const scoped = new Set(toArray(matches).map((id) => String(id)));
    if (scoped.size > maxResults) {
      throw new Error(`ECL result exceeds max size (${maxResults})`);
    }
    return scoped;
  }

  const left = await evaluateRefinement(node.left, options);
  const right = await evaluateRefinement(node.right, options);

  if (node.type === "refOr") {
    return unionSets(left, right, maxResults);
  }

  if (node.type === "refAnd") {
    return intersectSets(left, right);
  }

  throw new Error(`Unsupported ECL refinement node type '${node.type}'`);
}

export async function expandEclExpression({ expr, expandDescendants, expandRelationshipAttribute, maxResults = 200000 }) {
  if (typeof expandDescendants !== "function") {
    throw new Error("expandDescendants callback is required");
  }

  const ast = parseEclExpression(expr);
  const resultSet = await evaluateNode(ast, {
    expandDescendants,
    expandRelationshipAttribute,
    maxResults
  });

  return {
    ast,
    conceptIds: Array.from(resultSet),
    count: resultSet.size
  };
}
