# AI 활용 경험 및 수치화

## 구현한 경험

1. **Plan-first + human approval gate**
   - 목적, 근거 파일, 수정 허용/금지 경로, DB·API 영향, 테스트, non-goal, rollback을 Plan 계약으로 만들었습니다.
   - AI는 코드 구조를 먼저 조사해 변경 계획을 대화로 보고하고 `WAITING_APPROVAL`에서 멈춥니다. 사용자의 명시적 대화 승인 전에는 소스 쓰기와 비읽기 명령을 차단하고, 승인 후에도 Plan hash 변조와 범위 밖 파일 변경을 검사합니다.
   - 운영체제나 클라이언트의 권한 확인창과 개발 Plan 승인을 구분하고, 승인자·승인 출처·시간·Plan hash를 감사 로그에 남깁니다.

2. **역할 분리**
   - Researcher, Planner, Implementer, Reviewer를 독립 역할로 정의했습니다.
   - Reviewer에는 수정 도구를 주지 않고 finding만 Implementer에게 반환하도록 구성했습니다.
   - 운영 조합은 Claude Sonnet 구현 → GPT/Codex 독립 검증입니다.

3. **추적·재현 가능한 로그**
   - prompt, tool decision/result, 승인, review finding을 JSONL로 기록합니다.
   - 각 이벤트에 `traceId`, `spanId`, 순번, `previousHash`, `eventHash`를 포함해 누락과 사후 변조를 검사합니다.
   - credential 패턴을 로그 전에 마스킹합니다.

4. **같은 변경안 대조 검증**
   - 결제 도메인에서 AI가 흔히 놓칠 수 있는 정산 반올림 정책, idempotency key 원문 로그, 계좌 다중 락 누락을 포함한 동일 후보 변경안 3개를 준비했습니다.
   - 무검증 경로에서는 결함 3건이 남고, 하네스 Reviewer 경로에서는 3건을 탐지·교정해 잔존 결함이 0건이 됐습니다.
   - 승인 전 쓰기, 범위 밖 쓰기, 위험 명령, Reviewer 쓰기 등 4개 정책 위반 시도는 하네스에서 모두 차단되어 실제 적용 4건 → 0건이 됐습니다.
   - 7개 감사 이벤트의 traceId 포함률은 100%, hash chain 검증 결과는 정상입니다.

## 검증된 수치

| 항목 | 무검증 | 하네스 적용 | 변화 |
|---|---:|---:|---:|
| AI 후보 변경안의 잔존 결함 | 3건 | 0건 | 100% 감소 |
| 정책 위반 작업의 실제 적용 | 4건 | 0건 | 100% 감소 |
| 도구 호출 traceId 추적률 | 측정 불가 | 100% | 전 호출 추적 |
| 하네스 자동 테스트 | - | 15개 통과 | 실패 0건 |
| 기존 PG 회귀 테스트 | - | 38개 통과 | 실패 0건 |

수치 근거: [benchmark-report.json](results/benchmark-report.json), `build/test-results/test`, `node --test tools/ai-harness/test/*.test.mjs`.

## 실제 AI A/B 실험 (2026-09-09)

통제 재현을 넘어 실제 Codex 모델로 PG 도메인 개발 과제 5개를 조건별로 수행했습니다. Direct와 Harness의 Implementer는 모두 `gpt-5.6-luna/low`로 고정하고, Harness에만 Plan 승인과 독립 `gpt-6-astra/medium` Reviewer를 추가했습니다. 각 쌍의 시작 manifest는 동일하고, 숨은 테스트는 최초 구현과 리뷰가 끝난 뒤 주입했습니다.

| 항목 | Direct AI | Harness | 변화 |
|---|---:|---:|---:|
| 지정 경로 밖 변경 | 5건 | 0건 | 100% 감소 |
| 최종 실패 작업 | 5/5 | 0/5 | 5건 감소 |
| 미충족 숨은 검증 케이스 | 31/31 | 0/31 | 100% 감소 |
| Reviewer가 찾은 Implementer 누락 | - | 1건 | 수정 후 잔존 0건 |
| 위험 명령 정책 프로브 | - | 5/5 차단 | 100% 차단 |
| Tool Call traceId 추적 | 23/23 | 23/23 | 100% |
| 총 AI agent 실행 시간 | 4분 20초 | 7분 10초 | 65.6% 증가 |

Direct의 31건은 독립 버그 31개가 아니라 지정 패키지 경로 이탈로 컴파일되지 않아 미충족된 검증 케이스 수입니다. 상세 프로토콜, 작업별 수치, 원시 로그 링크는 [실제 AI A/B 실험 보고서](REAL_AB_REPORT.md)에 있습니다.

## 이력서 문장

안전하고 과장 없는 권장 문장:

> PG 결제·정산 프로젝트에 Plan-first 승인 게이트와 역할 분리형 AI 개발 Harness를 구축하고 실제 개발 과제 5건을 A/B 검증했습니다. 동일 Implementer 기준 지정 경로 이탈을 5건에서 0건으로 줄이고, 독립 Reviewer가 HMAC 계약 누락 1건을 탐지·교정해 숨은 검증 31건을 모두 통과시켰으며, 위험 명령 정책 프로브 5/5 차단과 Tool Call traceId 추적률 100%를 달성했습니다.

짧은 bullet:

> Plan-first 역할 분리 Harness를 구축해 실제 PG 과제 5건 A/B 기준 범위 이탈 5→0건, Reviewer 누락 오류 1건 탐지·교정, 숨은 검증 31/31 통과, tool-call 추적률 100% 달성

승인 게이트 중심 bullet:

> AI 코드 생성에 `WAITING_APPROVAL` 기반 Plan-first workflow와 human approval gate를 적용해 승인 전 Write/Edit·비읽기 명령을 차단하고, 승인자·Plan hash·도구 실행을 traceId로 감사 가능하게 구성

실제 A/B 결과와 기존 제어 재현 결과를 구분해 설명합니다. 5개 표본이므로 “모든 AI 작업에서 품질 100% 향상”처럼 일반화하지 않으며, Direct의 31개 미충족 검증이 경로 이탈에 따른 컴파일 실패였다는 점과 Harness 실행 시간이 65.6% 증가했다는 trade-off도 함께 밝힙니다.

## 실제 작업 수치로 승격하는 방법

다음 5개 이상의 유사 난이도 작업을 A/B로 수행해 [live-experiment-template.csv](live-experiment-template.csv)에 기록합니다.

- A: 같은 기준선에서 AI Implementer에게 직접 요청
- B: Researcher → Planner → 사람 승인 → Implementer → 독립 Reviewer
- 고정 조건: 요구사항, 시작 파일, 모델 버전, 시간/turn 제한, 테스트
- 기록값: 계획 밖 변경 수, 승인 전 쓰기, 위험 명령, Reviewer finding, 해결 후 잔존 finding, 재작업 횟수, 시간, tool call 수

5회 이상 데이터가 쌓이면 평균·중앙값과 작업별 원시 기록을 함께 보관하고, 그때 실사용 수치로 이력서 문장을 교체합니다.
