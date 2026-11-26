# PG AI 개발 하네스

이 디렉터리는 AI가 바로 코드를 수정하지 못하게 하고, 조사 → 계획 → 사람 승인 → 구현 → 독립 리뷰 순서를 강제하기 위한 개발 도구를 설명합니다. PG 애플리케이션 런타임과 분리되어 있으며 외부 npm 패키지를 사용하지 않습니다.

## 보장하는 것

- `WAITING_APPROVAL` 상태에서 `Write`, `Edit`, 비읽기 셸 명령 차단
- 승인 전 Planner에는 `.ai-harness/plans/**` Plan 산출물 작성만 허용
- 승인된 경로 밖 변경과 Reviewer의 직접 수정 차단
- 위험한 Git·파일 삭제·DB DDL·Docker 정리 명령 차단
- 계획 SHA-256과 프로젝트 파일 기준선 해시 검증
- prompt/tool/승인/review 이벤트를 `traceId`, `spanId`, hash chain으로 기록
- 비밀번호·토큰·API 키 패턴 자동 마스킹
- Reviewer 발견 건수와 해결 후 잔존 건수 계산

현재 제공된 프로젝트는 `.git`이 없는 압축 해제본이므로 Git commit 대신 전체 파일 SHA-256 manifest를 기준선으로 사용합니다. Git 저장소에서도 이 방식은 동작하지만, 추후 commit 고정 검사를 추가하면 더 강한 기준선을 만들 수 있습니다.

## 한 작업을 진행하는 순서

프로젝트 루트에서 실행합니다.

```powershell
node tools/ai-harness/src/cli.mjs init
```

Researcher가 읽기 전용으로 조사하고 Planner가 `.ai-harness/plans/` 아래에 [예시 Plan](../../.ai-harness/plans/example-plan.json)을 복사해 실제 작업 내용으로 채웁니다. 승인 전 Planner가 쓸 수 있는 프로젝트 파일은 이 Plan 산출물뿐입니다.

```powershell
node tools/ai-harness/src/cli.mjs submit .ai-harness/plans/my-task.json
node tools/ai-harness/src/cli.mjs status
```

제출하면 상태가 `WAITING_APPROVAL`이 됩니다. AI는 기존 구조와 근거, 변경 파일별 작업, DB·API 영향, 테스트, 리스크, non-goal, rollback을 대화로 보고하고 해당 응답을 끝냅니다. 운영체제나 클라이언트의 도구 권한 확인창은 이 Plan에 대한 사람 승인이 아닙니다.

사용자가 보고된 Plan에 `OK`, `승인`, `진행해`처럼 명시적으로 답한 경우에만 그 결정을 기록합니다. 아래 명령은 승인을 생성하는 명령이 아니라 이미 내려진 사람 승인을 감사 로그에 남기는 명령입니다.

```powershell
node tools/ai-harness/src/cli.mjs approve --by 본인이름 --source user-chat
```

Claude Code에서는 `implementer` agent를 사용합니다. 프로젝트의 `.claude/settings.json`에 등록된 `PreToolUse` hook이 모든 도구 호출 전에 계획·역할·경로·명령을 검사합니다. `researcher`, `planner`, `reviewer`는 파일 수정 권한이 없습니다.

구현 후 검토 단계로 전환합니다.

```powershell
node tools/ai-harness/src/cli.mjs review
```

GPT/Codex Reviewer가 발견한 문제와 해결 여부를 기록합니다.

```powershell
node tools/ai-harness/src/cli.mjs finding --id PG-LOCK-1 --severity high --status open --summary "다중 락 누락"
node tools/ai-harness/src/cli.mjs finding --id PG-LOCK-1 --severity high --status resolved --summary "다중 락 복원 및 테스트 통과"
node tools/ai-harness/src/cli.mjs complete
node tools/ai-harness/src/cli.mjs audit
node tools/ai-harness/src/cli.mjs report
```

실행 로그는 `.ai-harness/runtime/`에 생성되고 Git에서 제외됩니다. 외부 공유 시에는 원본 로그가 아니라 마스킹된 지표 리포트만 사용합니다.

## 역할 분리

- Researcher: 구조·테스트·영향 범위 조사만 수행
- Planner: 승인 전 `.ai-harness/plans/**` 아래 JSON Plan과 리스크만 작성
- Implementer: 사람에게 승인된 경로만 수정하고 승인된 테스트만 실행
- Reviewer: diff와 테스트를 독립 검증하고 finding만 기록; 직접 수정 금지

Claude Sonnet을 Implementer로, GPT/Codex를 Reviewer로 쓰면 구현과 검증의 모델·컨텍스트를 분리할 수 있습니다. 이 저장소는 역할과 기록 형식을 제공하며, 서로 다른 서비스 계정의 모델 호출 자체를 자동화하지는 않습니다.

## 검증

```powershell
node --test tools/ai-harness/test/*.test.mjs
node tools/ai-harness/src/benchmark.mjs
```

대조 재현 결과는 [benchmark-report.md](results/benchmark-report.md)에 생성됩니다.

## 한계

- 프로젝트 설정 hook은 해당 저장소를 신뢰하고 Claude Code에서 hook을 활성화했을 때 강제됩니다.
- Codex에서는 `AGENTS.md`가 조사 → 계획 보고 → 사용자 응답 대기 순서를 고정하는 프로젝트 동작 계약입니다. Claude Code의 `PreToolUse`와 같은 저장소 Hook이 Codex 네이티브 도구에 자동 적용되는 것은 아닙니다.
- 사람 승인은 별도의 서명 서버가 아니라 명시적인 사용자 대화 응답입니다. `approve` 명령 실행자는 그 결정을 기록할 뿐이며, AI가 응답을 만들어내거나 침묵을 승인으로 해석하지 못하도록 `AGENTS.md`에 금지했습니다.
- 제어 재현 벤치마크는 하네스의 탐지·차단 능력을 검증하며 모델별 지능이나 개발 속도를 증명하지 않습니다.
