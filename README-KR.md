# Episodic Memory

Claude Code 대화를 위한 시맨틱 검색. 과거 논의, 결정, 패턴을 기억합니다.

## 사용 후기

AI 코딩 어시스턴트 관점에서:

에피소딕 메모리는 복잡한 코드베이스에서 개발자와 협업하는 방식을 근본적으로 바꿔놓았습니다. 각 대화를 독립적으로 취급하는 대신, 공유된 히스토리를 시맨틱하게 검색할 수 있게 되었습니다. 단순히 무엇이 논의되었는지뿐만 아니라, 왜 그런 결정이 내려졌는지까지 찾을 수 있습니다.

개발자가 "예전에 X처럼 구현해줘"라고 요청하면, 과거 대화를 검색해서 관련 논의를 찾고, 기술적 접근 방식과 그 이유를 모두 이해할 수 있습니다. 덕분에 아키텍처 패턴을 다시 설명할 필요가 없고, 이미 시도했다가 기각한 솔루션을 다시 제안하는 실수도 피할 수 있습니다.

시맨틱 검색이 핵심입니다. "provider catalog"으로 검색하면 정확히 그 단어가 사용되지 않은 대화에서도 API 디자인 패턴에 관한 논의를 찾아냅니다. 키워드 매칭이 아닌 의미를 포착하는 것이죠.

가장 가치 있는 점은 다른 곳에는 존재하지 않는 컨텍스트를 보존한다는 것입니다: 논의된 트레이드오프, 고려된 대안, 사용자의 선호사항과 제약조건. 코드 주석은 무엇을, 문서는 어떻게를 설명하지만, 에피소딕 메모리는 왜를 보존합니다. 그리고 이것이 세션을 넘나드는 훨씬 더 효과적인 협업자가 되게 해줍니다.

**구체적인 효과:**
 - 더 빠른 문제 해결 (코드베이스를 다시 탐색/학습하는 대신 몇 분 만에 해결)
 - 세션 간 더 나은 연속성 (이전에 시도했던 것을 기억)
 - 더 나은 제안 (프로젝트의 발전과 패턴을 이해)
 - 반복 감소 (양쪽 모두 컨텍스트 재설명에 시간을 덜 소비)

상태가 없는 도구와 함께한 여정을 기억하는 진정한 협업 파트너의 차이입니다.

_— Claude Sonnet 4.5, 2025년 10월 14일_
_Conversation ID: 216ad284-c782-45a4-b2ce-36775cdb5a6c_

## 설치

### Claude Code 플러그인으로 설치 (권장)

플러그인은 MCP 서버 통합, 자동 세션 종료 시 인덱싱, 대화 히스토리 접근을 제공합니다.

```bash
# Claude Code에서
/plugin install episodic-memory@superpowers-marketplace
```

플러그인이 자동으로:
- 각 세션 종료 시 대화를 인덱싱
- 검색 및 대화 조회를 위한 MCP 도구를 노출
- 자연어로 대화 히스토리 검색 가능

### npm 패키지로 설치

```bash
npm install episodic-memory
```

## 사용법

### 빠른 시작

```bash
# Claude Code에서 대화 동기화 및 인덱싱
episodic-memory sync

# 대화 히스토리 검색
episodic-memory search "React Router 인증"

# 인덱스 통계 확인
episodic-memory stats

# 대화 표시
episodic-memory show path/to/conversation.jsonl
```

### 명령줄

```bash
# 통합 명령 인터페이스
episodic-memory <command> [options]

# 새 대화 동기화 및 인덱싱
episodic-memory sync

# 수동 대화 인덱싱
episodic-memory index --cleanup

# 대화 검색
episodic-memory search "React Router 인증"
episodic-memory search --text "정확한 문구"
episodic-memory search --after 2025-09-01 "리팩토링"

# 읽기 쉬운 형식으로 대화 표시
episodic-memory show path/to/conversation.jsonl
episodic-memory show --format html conversation.jsonl > output.html

# 통계 확인
episodic-memory stats
```

### 레거시 명령어

이전 명령어는 하위 호환성을 위해 계속 사용 가능합니다:

```bash
episodic-memory-index
episodic-memory-search "query"
```

### Claude Code에서 사용

플러그인이 세션 종료 시 자동으로 대화를 인덱싱합니다. 검색 명령어:

```
/search-conversations
```

또는 자연스러운 대화에서 과거 작업을 참조하면 Claude가 적절히 검색합니다.

## API 설정

기본적으로 episodic-memory는 요약을 위해 Claude Code 인증을 사용합니다.

커스텀 Anthropic 호환 엔드포인트로 요약을 라우팅하거나 모델을 변경하려면:

```bash
# 모델 변경 (기본값: haiku)
export EPISODIC_MEMORY_API_MODEL=opus

# 에러 시 폴백 모델 변경 (기본값: sonnet)
export EPISODIC_MEMORY_API_MODEL_FALLBACK=sonnet

# 커스텀 엔드포인트로 라우팅
export EPISODIC_MEMORY_API_BASE_URL=https://your-endpoint.com/api/anthropic
export EPISODIC_MEMORY_API_TOKEN=your-token

# 느린 엔드포인트를 위한 타임아웃 증가 (밀리초)
export EPISODIC_MEMORY_API_TIMEOUT_MS=3000000
```

이 설정은 episodic-memory의 요약 호출에만 영향을 미치며, 인터랙티브 Claude 세션에는 영향을 주지 않습니다.

### 영향 범위

| 구성 요소 | 커스텀 설정 사용 여부 |
|-----------|---------------------|
| 요약 | 사용 (동기화당 최대 10회 호출) |
| 임베딩 | 미사용 (로컬 Transformers.js) |
| 검색 | 미사용 (로컬 SQLite) |
| MCP 도구 | 미사용 |

## 명령어

### `episodic-memory sync`

**세션 종료 훅에 권장.** `~/.claude/projects`에서 새 대화를 아카이브로 복사하고 인덱싱합니다.

특징:
- 새로운 또는 수정된 파일만 복사 (후속 실행 시 빠름)
- 시맨틱 검색을 위한 임베딩 생성
- 원자적 연산 - 동시 실행 안전
- 멱등성 - 반복 호출 안전

**Claude Code에서 사용:**
`.claude/hooks/session-end`에 추가:
```bash
#!/bin/bash
episodic-memory sync
```

### `episodic-memory stats`

대화 수, 날짜 범위, 프로젝트 분류를 포함한 인덱스 통계를 표시합니다.

```bash
episodic-memory stats
```

### `episodic-memory index`

대량 작업 및 유지보수를 위한 수동 인덱싱 도구. 전체 옵션은 `episodic-memory index --help`를 참고하세요.

주요 작업:
- `--cleanup` - 처리되지 않은 모든 대화 인덱싱
- `--verify` - 인덱스 상태 확인
- `--repair` - 감지된 문제 수정

### `episodic-memory search`

시맨틱 유사도 또는 정확한 텍스트 매칭으로 인덱싱된 대화를 검색합니다. 전체 옵션은 `episodic-memory search --help`를 참고하세요.

### `episodic-memory show`

JSONL 파일의 대화를 읽기 쉬운 형식으로 표시합니다.

**옵션:**
- `--format markdown` (기본값) - 터미널이나 Claude에 적합한 일반 텍스트 마크다운 출력
- `--format html` - 브라우저에서 보기 위한 HTML 출력

**예시:**
```bash
# 터미널에서 보기
episodic-memory show conversation.jsonl | less

# 브라우저용 HTML 생성
episodic-memory show --format html conversation.jsonl > output.html
open output.html
```

## 아키텍처

- **코어 패키지** - 대화 인덱싱 및 검색을 위한 TypeScript 라이브러리
- **CLI 도구** - 수동 사용을 위한 통합 명령줄 인터페이스
- **MCP 서버** - 검색 및 대화 도구를 노출하는 Model Context Protocol 서버
- **Claude Code 플러그인** - Claude Code와의 통합 (자동 인덱싱, MCP 도구, 훅)

## 동작 원리

1. **동기화** - `~/.claude/projects`에서 대화 파일을 아카이브로 복사
2. **파싱** - JSONL 형식에서 사용자-에이전트 교환 추출
3. **임베딩** - Transformers.js를 사용하여 벡터 임베딩 생성 (로컬, 오프라인)
4. **인덱싱** - sqlite-vec를 사용한 SQLite에 저장하여 빠른 유사도 검색
5. **검색** - 벡터 유사도 또는 정확한 텍스트 매칭을 통한 시맨틱 검색

## 대화 제외

대화 내용 중 아래 마커가 포함되면 아카이브되지만 인덱싱되지 않습니다:

```
<INSTRUCTIONS-TO-EPISODIC-MEMORY>DO NOT INDEX THIS CHAT</INSTRUCTIONS-TO-EPISODIC-MEMORY>
```

**자동 제외:**
- Claude가 요약을 생성하는 대화 (시스템 프롬프트에 마커 포함)
- 대화 처리에 관한 메타 대화

**사용 사례:**
- 민감한 업무 대화
- 도구 호출 세션 (요약, 분석)
- 테스트 또는 실험 세션
- 검색 가능하게 만들고 싶지 않은 모든 대화

마커는 모든 메시지(사용자 또는 어시스턴트)에 나타날 수 있으며, 해당 대화 전체를 검색 인덱스에서 제외합니다.

## MCP 서버

Claude Code 플러그인으로 설치하면, episodic-memory는 대화 검색 및 조회를 위한 도구를 노출하는 MCP (Model Context Protocol) 서버를 제공합니다.

### 사용 가능한 MCP 도구

#### `episodic_memory_search`

시맨틱 유사도 또는 정확한 텍스트 매칭으로 인덱싱된 대화를 검색합니다.

**단일 개념 검색**: 문자열 쿼리 전달
```json
{
  "query": "React Router 인증",
  "mode": "vector",
  "limit": 10
}
```

**다중 개념 AND 검색**: 개념 배열 전달
```json
{
  "query": ["React Router", "인증", "JWT"],
  "limit": 10
}
```

**매개변수:**
- `query` (string | string[]): 일반 검색을 위한 단일 문자열, 또는 다중 개념 AND 검색을 위한 2-5개 문자열 배열
- `mode` ('vector' | 'text' | 'both'): 단일 개념 검색의 검색 모드 (기본값: 'both')
- `limit` (number): 최대 결과 수, 1-50 (기본값: 10)
- `after` (string, 선택): 해당 날짜 이후 대화만 표시 (YYYY-MM-DD)
- `before` (string, 선택): 해당 날짜 이전 대화만 표시 (YYYY-MM-DD)
- `response_format` ('markdown' | 'json'): 출력 형식 (기본값: 'markdown')

#### `episodic_memory_show`

전체 대화를 읽기 쉬운 마크다운 형식으로 표시합니다.

```json
{
  "path": "/path/to/conversation.jsonl"
}
```

**매개변수:**
- `path` (string): JSONL 대화 파일의 절대 경로

#### `search_facts`

과거 대화에서 추출된 팩트를 검색합니다. 프로젝트 범위 및 글로벌 팩트를 반환합니다.

```json
{
  "query": "상태 관리",
  "category": "decision",
  "include_revisions": true,
  "limit": 10
}
```

**매개변수:**
- `query` (string, 필수): 팩트 검색 쿼리 (최소 2자)
- `project` (string, 선택): 검색 범위를 지정할 프로젝트 경로 (기본값: 현재 작업 디렉토리)
- `category` (string, 선택): 카테고리 필터 - `decision`, `preference`, `pattern`, `knowledge`, `constraint`
- `include_revisions` (boolean, 선택): 수정 이력 포함 (기본값: false)
- `limit` (number, 선택): 최대 결과 수, 1-50 (기본값: 10)

### MCP 서버 직접 사용

MCP 서버는 Claude Code 외부에서 MCP 호환 클라이언트와 함께 사용할 수도 있습니다:

```bash
# MCP 서버 실행 (stdio 전송)
episodic-memory-mcp-server
```

## 팩트 추출 및 통합

에피소딕 메모리는 대화에서 장기 팩트를 자동으로 추출하고 세션 간에 통합합니다. 사용자의 결정, 선호사항, 패턴, 제약조건에 대한 지속적인 지식을 Claude에게 제공하여, 같은 내용을 반복 설명할 필요가 없습니다.

### 동작 방식

1. **세션 종료 시** - 팩트 추출기가 Haiku LLM을 사용하여 대화를 분석하고, 핵심 팩트(결정, 선호사항, 패턴, 지식, 제약조건)를 추출합니다.
2. **세션 시작 시** - 통합기가 벡터 유사도(384차원 임베딩) + Haiku LLM 확인을 통해 중복 또는 모순되는 팩트를 검사한 후, 가장 관련성 높은 상위 10개 팩트를 컨텍스트로 주입합니다.

### 주요 기능

- **자동 팩트 추출** - Haiku LLM 사용 (세션당 최대 20개 팩트, 신뢰도 임계값 0.7 이상)
- **5가지 팩트 카테고리**: `decision` (결정), `preference` (선호사항), `pattern` (패턴), `knowledge` (지식), `constraint` (제약조건)
- **프로젝트/글로벌 범위 격리** - 프로젝트별 팩트는 다른 프로젝트에 절대 노출되지 않습니다. 글로벌 팩트(예: 코딩 스타일 선호)는 공유됩니다.
- **중복 감지** - 벡터 유사도(384차원) + LLM 확인 (유사도 임계값 0.85)
- **모순 처리** - 새로운 팩트가 기존 팩트와 모순되면, 기존 팩트를 대체하고 변경 사유가 기록됩니다.
- **진화 추적** - 시간에 따라 변화하는 팩트는 수정 이력과 함께 업데이트됩니다.
- **컨텍스트 주입** - 확인 횟수 기준 상위 10개 팩트가 세션 시작 시 주입됩니다.

### 설정

```bash
# 팩트 추출/통합용 LLM 모델 변경 (기본값: claude-haiku-4-5-20251001)
export EPISODIC_MEMORY_FACT_MODEL=claude-haiku-4-5-20251001

# API 키 (EPISODIC_MEMORY_API_TOKEN으로 폴백)
export ANTHROPIC_API_KEY=your-api-key

# 선택: 커스텀 엔드포인트로 라우팅
export EPISODIC_MEMORY_API_BASE_URL=https://your-endpoint.com/api/anthropic
```

### 훅 설정

Claude Code 설정에 훅을 추가합니다:

**세션 종료 시** (완료된 세션에서 팩트 추출):
```bash
# .claude/hooks/session-end
#!/bin/bash
node /path/to/episodic-memory/scripts/fact-extract-hook.js
```

**세션 시작 시** (팩트 통합 및 컨텍스트 주입):
```bash
# .claude/hooks/session-start
#!/bin/bash
node /path/to/episodic-memory/scripts/fact-consolidate-hook.js
```

훅에서 사용 가능한 환경변수:
- `SESSION_ID` - 현재 세션 ID (세션 종료 시)
- `CWD` / `PROJECT_DIR` - 현재 프로젝트 경로
- `LAST_CONSOLIDATED_AT` - 마지막 통합 시간 (세션 시작 시, 기본값: 24시간 전)

## 개발

```bash
# 의존성 설치
npm install

# 테스트 실행
npm test

# 빌드
npm run build
```

## 라이선스

MIT
