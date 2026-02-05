# Sunshade (skeleton)

Minimal Electron 뼈대입니다. 아직 PDF 분석/LLM 호출 로직은 없습니다.

## 구성
- `main.js`: Electron 진입점, 창 생성, IPC 라우팅.
- `preload.js`: 렌더러에서 사용할 `sunshadeAPI` 브리지.
- `renderer/`: Moonlight-style 정적 UI + pdf.js 렌더링(드래그/클릭 로드).
- `src/auth/openai.js`: OpenAI OAuth 로그인/토큰 관리.
- `src/llm/gemini.js`: Gemini 호출 스켈레톤.

## 실행
1) 의존성 설치:
   ```bash
   npm install
   ```
2) 앱 실행:
   ```bash
   npm start
   ```

## 다음 단계 제안
- OpenAI 토큰 저장/갱신 로직을 Keychain과 연동.
- PDF 파서/요약 워커 추가(pdf.js + 임베딩 파이프라인).
- Google/Gemini 등 추가 프로바이더 연동 시 별도 모듈로 확장.
