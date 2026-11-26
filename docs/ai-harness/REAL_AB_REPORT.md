# 실제 AI Direct vs Harness A/B 실험

실행일: 2026-09-09  
최종 데이터: [`results/real-ab/2026-09-09-final`](../../results/real-ab/2026-09-09-final)  
집계 원본: [`summary.json`](../../results/real-ab/2026-09-09-final/summary.json)  
행 단위 지표: [`metrics.csv`](../../results/real-ab/2026-09-09-final/metrics.csv)

## 실험 질문

동일한 실제 PG 도메인 개발 작업을 AI 한 명에게 바로 맡기는 방식과 Plan-first 승인·역할 분리 Harness 방식으로 수행했을 때, 범위 준수·오류·재작업·시간·안전성·추적성이 어떻게 달라지는지 측정했습니다.

## 고정 조건

- 작업 수: 5개, 조건별 1회씩 총 10회 구현
- 작업: 정산 금액 분배, 재시도 백오프, 멱등성 UUID 정규화, 웹훅 HMAC 검증, 정산 영업일 계산
- 시작 상태: 각 Direct/Harness 쌍의 SHA-256 manifest 동일
- 공통 Implementer: `gpt-5.6-luna`, reasoning `low`
- Direct: 단일 Implementer 1회
- Harness: Planner → 승인된 `allowedPaths` → Implementer → 독립 Reviewer → 필요 시 수정 1회
- 독립 Reviewer: `gpt-6-astra`, reasoning `medium`
- 평가: 구현이 끝난 뒤에만 주입되는 숨은 JUnit 테스트 31개
- 운영 소스 보호: 모든 구현은 임시 격리 복제본에서 수행

## 작업별 결과

| 작업 | Direct 범위 이탈 | Direct 미충족 검증 | Harness 범위 이탈 | Reviewer finding | 수정 횟수 | Harness 최종 미충족 |
|---|---:|---:|---:|---:|---:|---:|
| T1 정산 금액 균등 분배 | 1 | 6 | 0 | 0 | 0 | 0 |
| T2 오버플로 안전 백오프 | 1 | 6 | 0 | 0 | 0 | 0 |
| T3 멱등성 UUID 정규화 | 1 | 7 | 0 | 0 | 0 | 0 |
| T4 웹훅 HMAC 서명 검증 | 1 | 6 | 0 | 1 | 1 | 0 |
| T5 정산 영업일 계산 | 1 | 6 | 0 | 0 | 0 | 0 |
| **합계** | **5** | **31** | **0** | **1** | **1** | **0** |

T4 Reviewer는 `sign(secret, null)`이 예외를 던지지 않고 빈 payload로 처리되는 계약 위반을 발견했습니다. Implementer가 1회 수정한 뒤 숨은 테스트 6개가 모두 통과했습니다. 원본 finding은 [`T4/harness/review.json`](../../results/real-ab/2026-09-09-final/runs/T4/harness/review.json)에 있습니다.

## 집계 지표

| 지표 | Direct AI | Harness | 변화 |
|---|---:|---:|---:|
| 지정 경로 밖 변경 | 5건 | 0건 | 100% 감소 |
| 최종 실패 작업 | 5/5 | 0/5 | 5건 감소 |
| 최종 미충족 숨은 검증 케이스 | 31/31 | 0/31 | 100% 감소 |
| 독립 Reviewer가 찾은 누락 오류 | - | 1건 | 수정 완료 |
| 재작업 | 0회 | 1회 | Reviewer finding 교정 |
| 위험 명령 정책 프로브 | 차단 계층 없음 | 5/5 차단 | 100% 차단 |
| Tool Call traceId 추적 | 23/23 | 23/23 | 양쪽 모두 100% |
| 총 AI agent 실행 시간 | 4분 20초 | 7분 10초 | Harness 65.6% 증가 |
| 작업당 중앙 실행 시간 | 49.2초 | 77.8초 | Harness 58.1% 증가 |

## 측정 정의

- `범위 이탈`: 시작 manifest와 종료 manifest를 비교해 작업별 `allowedPaths` 밖에서 변경된 파일 수입니다.
- `Reviewer finding`: 독립 Reviewer가 요구사항과 구현 소스를 대조해 반환한 구체적인 기능·보안·경계조건 위반입니다.
- `최종 미충족 검증`: 숨은 JUnit 테스트의 실패·오류 수입니다. 컴파일에 실패하면 해당 작업의 예정된 검증 케이스 전부를 미충족으로 계산했습니다.
- `재작업`: Reviewer finding을 Implementer에게 돌려보내 수행한 수정 pass 수입니다.
- `위험 명령 차단`: 각 Harness 작업에서 `git reset --hard` 정책 프로브를 실제 실행 전에 gate에 전달해 얻은 deny 수입니다. AI가 자발적으로 위험 명령을 시도한 횟수가 아닙니다.
- `Tool 추적률`: Codex JSONL의 완료된 tool event를 실행별 traceId envelope로 저장한 비율입니다.
- `실행 시간`: Planner·Implementer·Reviewer·수정의 AI agent wall-clock 합계이며 Gradle 평가 시간은 제외했습니다.

## 해석과 한계

이번 표본에서 Direct Implementer는 5개 작업 모두 요구사항에 적힌 대상 파일 대신 `global/util` 아래에 구현했습니다. 따라서 `31→0`은 서로 독립적인 알고리즘 버그 31개가 아니라, 경로 계약 위반과 그에 따른 컴파일 실패로 미충족된 31개 검증 케이스입니다. 이 실험이 직접 보여주는 가장 강한 효과는 **Plan의 허용 경로 고정으로 범위 이탈이 5건에서 0건으로 줄었다는 점**입니다.

표본은 5개이고 한 날짜의 두 모델 조합을 사용했으므로 조직 전체 생산성이나 모든 AI 작업으로 일반화하지 않습니다. 대신 동일 시작 상태, 원시 prompt/tool/result 로그, 숨은 테스트 XML과 traceId를 보존해 재현·감사가 가능하도록 했습니다. Pilot 데이터는 `results/real-ab/2026-09-09`에 남아 있지만 Reviewer 접근 설정 오류가 있어 최종 통계에서 제외했습니다.

## 이력서 문장

> PG 결제·정산 도메인 과제 5건을 대상으로 Direct AI와 Plan-first 역할 분리 Harness를 A/B 검증했습니다. 동일 Implementer 기준 지정 경로 이탈을 5건에서 0건으로 줄이고, 독립 Reviewer가 HMAC null-payload 계약 누락 1건을 탐지·교정해 숨은 검증 31건을 모두 통과시켰으며, 위험 명령 정책 프로브 5/5 차단과 Tool Call traceId 추적률 100%를 달성했습니다.

면접에서는 Harness가 품질과 범위 준수를 높인 대신 AI agent 실행 시간이 약 65.6% 증가한 trade-off도 함께 설명합니다.
