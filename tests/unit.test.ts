// 그림 연산 로그 재생(replay) 단위 테스트 — 실행: npm run test:unit
import assert from 'node:assert/strict';
import { replay, type Op } from '../src/drawing/ops.ts';

const s = (id: string): Op => ({ k: 's', id, c: '#000000', w: 4, p: [0, 0, 10, 10] });
const ids = (ops: Op[]) => replay(ops).strokes.map((x) => x.id).join(',');

const cases: [string, Op[], string][] = [
  ['획 누적', [s('a'), s('b')], 'a,b'],
  ['실행 취소', [s('a'), s('b'), { k: 'u' }], 'a'],
  ['다시 실행', [s('a'), s('b'), { k: 'u' }, { k: 'r' }], 'a,b'],
  ['새 획을 그리면 redo 스택 초기화', [s('a'), s('b'), { k: 'u' }, s('c'), { k: 'r' }], 'a,c'],
  ['전체 지우기', [s('a'), s('b'), { k: 'c' }], ''],
  ['전체 지우기도 실행 취소 가능', [s('a'), s('b'), { k: 'c' }, { k: 'u' }], 'a,b'],
  ['지운 뒤 다시 그리기', [s('a'), { k: 'c' }, s('b')], 'b'],
  ['빈 상태에서 실행 취소는 무시', [{ k: 'u' }, { k: 'u' }, s('a')], 'a'],
];

let failed = 0;
for (const [name, ops, expected] of cases) {
  try {
    assert.equal(ids(ops), expected);
    console.log('  ✅', name);
  } catch {
    failed++;
    console.log('  ❌', name, '→', ids(ops), '(기대값', expected + ')');
  }
}
const r = replay([s('a'), { k: 'u' }]);
assert.equal(r.canUndo, false);
assert.equal(r.canRedo, true);
console.log('  ✅ canUndo / canRedo 상태');
console.log(failed ? `${failed}개 실패` : '모두 통과');
process.exit(failed ? 1 : 0);
