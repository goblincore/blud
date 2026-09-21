// scripts/lib/seam-literal.ts
//
// ONE definition of "where is game-main's __sdfGame, and where does a new
// seam factory go", shared by scripts/extract-seam-group.ts and
// scripts/integrate-seams.ts. They each had their own finder, and the two
// had already diverged (integrate-seams still took "the longest statement
// mentioning __sdfGame", the heuristic extract-seam-group had to abandon
// when it started picking the setDrawFn closure).
//
// THE SHAPE, and the one it refuses:
//
//   __sdfGame = mergeSeams(createA(ctx), createB(ctx), { inline members })
//
// is the only accepted form. The old
//
//   __sdfGame = { ...createA(ctx), ...createB(ctx), inline members }
//
// is REJECTED, loudly. That shape froze every seam getter at its boot value
// (an object spread reads each accessor once and copies the value — see
// src/lab/sdf-zombie/webgpu/seam-merge.ts), and these two tools are exactly
// what would write it back in: they used to emit `...createX(ctx),` into the
// literal. A tool that quietly re-introduces a fixed bug is worse than one
// that stops.
import ts from 'typescript';

export interface SeamLiteral {
  /** The inline-members object literal — mergeSeams' LAST argument. */
  obj: ts.ObjectLiteralExpression;
  /** Where to insert `createX(ctx, deps),\n    ` so the new factory lands
   *  after every existing factory and before the inline members — the same
   *  override order a spread at that position had. */
  insertAt: number;
}

export function findSeamLiteral(main: ts.FunctionDeclaration, sf: ts.SourceFile): SeamLiteral {
  const assigns = main.body!.statements.filter((s): s is ts.ExpressionStatement =>
    ts.isExpressionStatement(s)
    && ts.isBinaryExpression(s.expression)
    && s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && s.expression.left.getText(sf).includes('__sdfGame'));
  if (assigns.length !== 1) {
    throw new Error(`expected exactly one \`__sdfGame = …\` assignment in main(), found ${assigns.length}`);
  }
  const rhs = (assigns[0]!.expression as ts.BinaryExpression).right;
  if (ts.isObjectLiteralExpression(rhs)) {
    throw new Error(
      '__sdfGame is assigned an object LITERAL. Build it with mergeSeams(...factories, { members }) '
      + 'instead: an object spread copies each seam getter\'s value once, freezing it at boot '
      + '(src/lab/sdf-zombie/webgpu/seam-merge.ts explains). Refusing rather than emitting '
      + '`...createX(ctx)` back into it.');
  }
  if (!ts.isCallExpression(rhs) || rhs.expression.getText(sf) !== 'mergeSeams') {
    throw new Error(`expected \`__sdfGame = mergeSeams(…)\`, found \`__sdfGame = ${rhs.getText(sf).slice(0, 40)}…\``);
  }
  const last = rhs.arguments.at(-1);
  if (!last || !ts.isObjectLiteralExpression(last)) {
    throw new Error('mergeSeams(…)\'s LAST argument must be the inline-members object literal');
  }
  if (rhs.arguments.some(a => ts.isSpreadElement(a))) {
    throw new Error('mergeSeams(…) must list its factories as plain arguments, not spreads');
  }
  return { obj: last, insertAt: last.getStart(sf) };
}
