// D1 アクセス層で発生したエラーをラップするクラス。
// src/index.ts の onError で instanceof 判定に使う。

/** D1 呼び出し時の例外をラップして再スローするためのエラー型。 */
export class D1Error extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D1Error";
  }
}
